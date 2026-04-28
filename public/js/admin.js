import { db } from "./firebase-config.js";
import { collection, query, where, orderBy, onSnapshot, doc, setDoc, updateDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// Navigation
window.navigate = function navigate(pageId) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById(pageId).classList.add('active');
    window.scrollTo(0, 0);
}

// Shop Status Toggle
document.getElementById('shop-toggle').addEventListener('change', async function(e) {
    const isAccepting = e.target.checked;
    
    try {
        await setDoc(doc(db, "config", "shop"), { acceptingJobs: isAccepting }, { merge: true });
    } catch (error) {
        console.error("Error updating shop status: ", error);
        alert("Failed to update status.");
    }
});

// Update Pricing
window.updatePricing = async function() {
    const bw = parseFloat(document.getElementById('price-bw').value) || 2;
    const color = parseFloat(document.getElementById('price-color').value) || 10;
    
    try {
        await setDoc(doc(db, "config", "shop"), { 
            prices: { bw: bw, color: color } 
        }, { merge: true });
    } catch (error) {
        console.error("Error updating prices: ", error);
        alert("Failed to update pricing.");
    }
}

// Listen to own status to update UI based on DB
onSnapshot(doc(db, "config", "shop"), (docSnap) => {
    if (docSnap.exists()) {
        const data = docSnap.data();
        document.getElementById('shop-toggle').checked = data.acceptingJobs;
        const textEl = document.getElementById('shop-status-text');
        
        if (data.acceptingJobs) {
            textEl.textContent = 'ACCEPTING JOBS';
            textEl.classList.remove('text-danger');
            textEl.classList.add('text-success');
        } else {
            textEl.textContent = 'PAUSED - NO NEW JOBS';
            textEl.classList.add('text-danger');
            textEl.classList.remove('text-success');
        }
        
        // Update Pricing Inputs
        if (data.prices) {
            document.getElementById('price-bw').value = data.prices.bw || 2;
            document.getElementById('price-color').value = data.prices.color || 10;
        }
    }
});

// Admin Actions
let currentJobs = [];
let activeJobId = null;

window.startNextJob = async function startNextJob() {
    const nextJobEl = document.getElementById('next-job');
    if (nextJobEl.textContent === 'None' || currentJobs.length === 0) return;

    const nextJob = currentJobs[0];
    
    // Update UI
    document.getElementById('current-job').textContent = nextJob.token;
    
    try {
        // Mark as printing
        await updateDoc(doc(db, "jobs", nextJob.id), { status: "printing" });
        activeJobId = nextJob.id;
    } catch(e) {
        console.error("Error updating job", e);
    }
}

window.pausePrinter = function pausePrinter() {
    alert("Printer command: PAUSE sent.");
}

// Listen to pending jobs
const q = query(collection(db, "jobs"), where("status", "==", "pending"), orderBy("createdAt", "asc"));
onSnapshot(q, (snapshot) => {
    currentJobs = [];
    snapshot.forEach((doc) => {
        currentJobs.push({ id: doc.id, ...doc.data() });
    });
    
    if (currentJobs.length > 0) {
        const nextJob = currentJobs[0];
        document.getElementById('next-job').textContent = nextJob.token;
        document.getElementById('next-job-meta').textContent = `${nextJob.files.length} Files • ${nextJob.totalPrice}`;
        
        let filesHtml = nextJob.files.map(f => `<div><a href="${f.url}" target="_blank" class="text-primary">${f.name}</a></div>`).join('');
        document.getElementById('next-job-files').innerHTML = filesHtml;
    } else {
        document.getElementById('next-job').textContent = "None";
        document.getElementById('next-job-meta').textContent = "0 Files";
        document.getElementById('next-job-files').innerHTML = "";
    }
});

function showError() {
    document.getElementById('error-alert').classList.remove('hidden');
}

function hideError() {
    document.getElementById('error-alert').classList.add('hidden');
}

// Cost Monitoring & Usage Tracking
const startOfDay = new Date();
startOfDay.setHours(0,0,0,0);

const todayQuery = query(collection(db, "jobs"), where("createdAt", ">=", startOfDay));
onSnapshot(todayQuery, (snapshot) => {
    let jobCount = snapshot.docs.length;
    let estimatedStorageMB = jobCount * 2.5; // Average 2.5MB per job
    
    const maxJobs = 200;
    document.getElementById('daily-jobs-count').textContent = `${jobCount} / ${maxJobs}`;
    document.getElementById('daily-storage-count').textContent = `${estimatedStorageMB.toFixed(1)} MB / 500 MB`;
    
    let usagePercent = (jobCount / maxJobs) * 100;
    const progressEl = document.getElementById('usage-progress');
    const statusEl = document.getElementById('usage-status');
    
    if (progressEl && statusEl) {
        progressEl.style.width = `${usagePercent}%`;
        
        if (usagePercent >= 90) {
            progressEl.style.background = '#dc3545'; // Danger
            statusEl.style.background = '#dc3545';
            statusEl.textContent = 'Critical Limit';
            // Auto-disable shop if overloaded
            if (document.getElementById('shop-toggle').checked) {
                document.getElementById('shop-toggle').click();
                alert("Shop automatically closed due to Free Tier limit approaching!");
            }
        } else if (usagePercent >= 75) {
            progressEl.style.background = '#ffc107'; // Warning
            statusEl.style.background = '#ffc107';
            statusEl.textContent = 'High Usage Warning';
        } else {
            progressEl.style.background = '#28a745'; // Safe
            statusEl.style.background = '#28a745';
            statusEl.textContent = 'Safe Limit';
        }
    }
});
