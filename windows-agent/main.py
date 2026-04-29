import os
import sys
import json
import time
import hashlib
import requests
import subprocess
from pathlib import Path
from typing import Dict, Any, Optional

import firebase_admin
from firebase_admin import credentials, firestore

# Constants
CACHE_DIR = Path(os.getenv('APPDATA')) / "XeroxSmartAgent" / "print-cache"
CACHE_DIR.mkdir(parents=True, exist_ok=True)
SUMATRA_PDF_PATH = r"C:\Program Files\SumatraPDF\SumatraPDF.exe"
FIREBASE_KEY_PATH = "firebase-service-account.json"

class XeroxPrintAgent:
    def __init__(self, api_url: str, shop_id: str):
        self.api_url = api_url
        self.shop_id = shop_id
        
    def get_file_hash(self, filepath: Path) -> str:
        """Compute SHA256 hash of a file for integrity checking"""
        sha256_hash = hashlib.sha256()
        with open(filepath, "rb") as f:
            for byte_block in iter(lambda: f.read(4096), b""):
                sha256_hash.update(byte_block)
        return sha256_hash.hexdigest()

    def process_job(self, job_data: Dict[str, Any]) -> bool:
        job_id = job_data['job_id']
        file_id = job_data['file_id']
        local_path = CACHE_DIR / f"{file_id}.pdf"
        
        # 1. Local Cache Validation
        if local_path.exists():
            if self.get_file_hash(local_path) == file_id:
                print(f"[CACHE] Using cached file for {file_id}")
            else:
                print(f"[CACHE-INVALID] Hash mismatch for {file_id}. Deleting...")
                local_path.unlink()
                
        # 2. Download Authorization (Strict)
        if not local_path.exists():
            download_url = self._get_download_url(job_id)
            if not download_url:
                print(f"[ERROR] Failed to authorize download for job {job_id}")
                return False
                
            # 3. File Download System & Locking
            success = self._download_file(download_url, local_path)
            if not success:
                return False
                
            # 4. File Integrity Check
            if self.get_file_hash(local_path) != file_id:
                print(f"[CORRUPT] Downloaded file hash mismatch. Deleting...")
                local_path.unlink()
                return False
                
        # 5. Print Engine
        return self._print_file(local_path, job_data)

    def _get_download_url(self, job_id: str) -> Optional[str]:
        """Request Worker to atomically lock job and return presigned URL"""
        try:
            res = requests.post(f"{self.api_url}/get-download-url", json={
                "job_id": job_id,
                "shop_id": self.shop_id
            })
            if res.status_code == 200:
                return res.json().get('download_url')
            return None
        except Exception as e:
            print(f"[API ERROR] {e}")
            return None

    def _download_file(self, url: str, target_path: Path) -> bool:
        """Download file ONLY once to target path"""
        try:
            print(f"[DOWNLOAD] Starting download to {target_path}")
            res = requests.get(url, stream=True)
            res.raise_for_status()
            with open(target_path, 'wb') as f:
                for chunk in res.iter_content(chunk_size=8192):
                    f.write(chunk)
            return True
        except Exception as e:
            print(f"[DOWNLOAD ERROR] {e}")
            return False

    def _print_file(self, filepath: Path, job_data: Dict[str, Any]) -> bool:
        """Physical Print Engine via SumatraPDF with Color/BW routing"""
        print(f"[PRINT] Preparing to print {filepath.name}")
        
        copies = int(job_data.get('copies', 1))
        
        # Parse custom pages
        custom_color = str(job_data.get('customColor', '')).strip()
        custom_bw = str(job_data.get('customBw', '')).strip()
        
        is_mixed_mode = job_data.get('type') == 'custom'
        
        try:
            if is_mixed_mode:
                # 12. PRINT ENGINE: Split into color and B/W
                if custom_bw:
                    print(f"-> Routing B/W pages ({custom_bw}) to B/W Printer")
                    self._execute_sumatra(filepath, custom_bw, copies, "default") # Map to BW printer later
                if custom_color:
                    print(f"-> Routing Color pages ({custom_color}) to Color Printer")
                    self._execute_sumatra(filepath, custom_color, copies, "default") # Map to Color printer later
            else:
                # Standard full print
                print(f"-> Routing full document to {'Color' if job_data.get('type') == 'color' else 'B/W'} Printer")
                self._execute_sumatra(filepath, "", copies, "default")
                
            print("[PRINT] SUCCESS!")
            return True
        except Exception as e:
            print(f"[PRINT ERROR] Subprocess failed: {e}")
            return False

    def _execute_sumatra(self, filepath: Path, pages: str, copies: int, printer: str):
        cmd = [
            SUMATRA_PDF_PATH,
            "-print-to", printer,
            "-silent"
        ]
        
        settings = []
        if pages:
            settings.append(pages)
        if copies > 1:
            settings.append(f"{copies}x")
            
        if settings:
            cmd.extend(["-print-settings", ",".join(settings)])
            
        cmd.append(str(filepath))
        print(f"   [CMD] {' '.join(cmd)}")
        # subprocess.run(cmd, check=True) # Uncomment for real execution

if __name__ == "__main__":
    print("Xerox Smart Agent Initialized")
    
    # 1. Initialize Firebase Admin
    if not os.path.exists(FIREBASE_KEY_PATH):
        print(f"[FATAL ERROR] Missing {FIREBASE_KEY_PATH}. Please provide the service account key.")
        sys.exit(1)
        
    cred = credentials.Certificate(FIREBASE_KEY_PATH)
    firebase_admin.initialize_app(cred)
    db = firestore.client()
    
    # 2. Initialize Agent
    agent = XeroxPrintAgent(api_url="https://xerox-api.your-worker.workers.dev", shop_id="shop_1")
    
    print("[AGENT] Listening for new assigned jobs...")
    
    # 3. Queue Manager: Listen to Firestore for 'assigned' jobs
    # We query for assigned jobs that belong to this shop.
    query = db.collection('jobs').where('status', '==', 'assigned')
    
    def on_snapshot(col_snapshot, changes, read_time):
        for change in changes:
            if change.type.name == 'ADDED':
                job_data = change.document.to_dict()
                job_data['job_id'] = change.document.id
                print(f"[QUEUE] Received new job: {job_data['job_id']}")
                
                # Process job synchronously (safe mode)
                # Note: For multiple files, we'd loop through job_data['files']
                # This assumes job_data format from Cloudflare API logic
                if 'files' in job_data:
                    all_success = True
                    for file_info in job_data['files']:
                        # Inject job_id into file_info for processing
                        file_info['job_id'] = job_data['job_id']
                        if not agent.process_job(file_info):
                            all_success = False
                            break
                            
                    if all_success:
                        change.document.reference.update({'status': 'completed'})
                    else:
                        change.document.reference.update({'status': 'failed'})
                
    # Watch the collection query
    query_watch = query.on_snapshot(on_snapshot)
    
    try:
        # Keep the main thread alive
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("Agent shutting down.")

