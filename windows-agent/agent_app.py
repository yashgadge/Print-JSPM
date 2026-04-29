import sys
import os
import time
from pathlib import Path

from PyQt6.QtWidgets import QApplication
from PyQt6.QtCore import QThread, pyqtSignal

import firebase_admin
from firebase_admin import credentials, firestore

from main import XeroxPrintAgent, FIREBASE_KEY_PATH
from gui import XeroxPrintAgentGUI

class FirebaseListenerThread(QThread):
    new_job_signal = pyqtSignal(dict)
    status_signal = pyqtSignal(str)
    
    def __init__(self):
        super().__init__()
        self.db = firestore.client()
        self.running = True

    def run(self):
        self.status_signal.emit("Listening to Firestore...")
        query = self.db.collection('jobs').where('status', '==', 'assigned')
        
        def on_snapshot(col_snapshot, changes, read_time):
            for change in changes:
                if change.type.name == 'ADDED':
                    job_data = change.document.to_dict()
                    job_data['job_id'] = change.document.id
                    job_data['ref'] = change.document.reference
                    self.new_job_signal.emit(job_data)
                    
        self.watch = query.on_snapshot(on_snapshot)
        
        while self.running:
            time.sleep(1)
            
    def stop(self):
        self.running = False
        if hasattr(self, 'watch'):
            self.watch.unsubscribe()

class WorkerThread(QThread):
    finished_signal = pyqtSignal(bool, object)
    
    def __init__(self, agent, file_info, ref):
        super().__init__()
        self.agent = agent
        self.file_info = file_info
        self.ref = ref
        
    def run(self):
        success = self.agent.process_job(self.file_info)
        self.finished_signal.emit(success, self.ref)

class AgentController:
    def __init__(self):
        self.app = QApplication(sys.argv)
        self.gui = XeroxPrintAgentGUI()
        self.agent = XeroxPrintAgent(api_url="https://xerox-api.yashgadge14.workers.dev", shop_id="shop_1")
        
        self.gui.btn_start.clicked.connect(self.start_queue)
        self.gui.btn_pause.clicked.connect(self.pause_queue)
        
        self.pending_jobs = []
        self.is_processing = False
        
        self.listener_thread = None
        self.worker_thread = None

    def start_queue(self):
        self.gui.lbl_status.setText("Status: Active")
        self.gui.lbl_status.setStyleSheet("font-size: 16px; font-weight: bold; color: green;")
        
        if not self.listener_thread:
            self.listener_thread = FirebaseListenerThread()
            self.listener_thread.new_job_signal.connect(self.on_new_job)
            self.listener_thread.status_signal.connect(lambda s: print(s))
            self.listener_thread.start()
            
        self.process_next()

    def pause_queue(self):
        self.gui.lbl_status.setText("Status: Paused")
        self.gui.lbl_status.setStyleSheet("font-size: 16px; font-weight: bold; color: orange;")
        if self.listener_thread:
            self.listener_thread.stop()
            self.listener_thread = None

    def on_new_job(self, job_data):
        self.pending_jobs.append(job_data)
        self.gui.lst_queue.addItem(f"Job: {job_data['job_id']}")
        self.process_next()

    def process_next(self):
        if self.is_processing or not self.pending_jobs:
            return
            
        if self.gui.lbl_status.text() == "Status: Paused":
            return
            
        self.is_processing = True
        job = self.pending_jobs.pop(0)
        
        # Remove from UI list
        self.gui.lst_queue.takeItem(0)
        
        print(f"Processing job: {job['job_id']}")
        # For simplicity in this example, processing just the first file
        if 'files' in job and job['files']:
            file_info = job['files'][0]
            file_info['job_id'] = job['job_id']
            
            self.worker_thread = WorkerThread(self.agent, file_info, job['ref'])
            self.worker_thread.finished_signal.connect(self.on_worker_finished)
            self.worker_thread.start()
        else:
            self.is_processing = False
            self.process_next()
            
    def on_worker_finished(self, success, ref):
        if success:
            ref.update({'status': 'completed'})
        else:
            ref.update({'status': 'failed'})
            
        self.is_processing = False
        self.process_next()

def init_firebase():
    if not os.path.exists(FIREBASE_KEY_PATH):
        print(f"[FATAL ERROR] Missing {FIREBASE_KEY_PATH}")
        sys.exit(1)
    cred = credentials.Certificate(FIREBASE_KEY_PATH)
    firebase_admin.initialize_app(cred)

if __name__ == "__main__":
    init_firebase()
    controller = AgentController()
    controller.gui.show()
    sys.exit(controller.app.exec())
