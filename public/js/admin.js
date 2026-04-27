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
