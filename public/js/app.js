import { db } from "./firebase-config.js";
import { collection, addDoc, serverTimestamp, doc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { supabase } from "./supabase-config.js";

// State
let files = [];
let currentCustomFileId = null;

// Pricing (Dummy)
const PRICES = {
    bw: 2,
    color: 10
};

// Navigation
window.navigate = function navigate(pageId) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById(pageId).classList.add('active');
    window.scrollTo(0, 0);
}

// File Upload
document.getElementById('file-upload').addEventListener('change', function(e) {
    const selectedFiles = Array.from(e.target.files);
    handleNewFiles(selectedFiles);
});

window.fetchWhatsAppFiles = function fetchWhatsAppFiles() {
    const code = document.getElementById('whatsapp-code').value;
    if (!code) return alert("Please enter a code");
    
    // Mock fetch
    const mockFiles = [
        { name: "Document_from_whatsapp.pdf", type: "application/pdf", size: 1024 * 1024 * 2 }
    ];
    handleNewFiles(mockFiles);
}

function handleNewFiles(newFiles) {
    // Validation
    const allowedTypes = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'text/plain', 'image/jpeg', 'image/png', 'image/jpg'];
    
    for (let f of newFiles) {
        if (f.size > 20 * 1024 * 1024) {
            alert(`${f.name} is too large (Max 20MB)`);
            continue;
        }
        
        files.push({
            id: 'file_' + Date.now() + Math.random().toString(36).substr(2, 9),
            name: f.name,
            fileObj: f,
            type: 'bw', // default bw
            copies: 1,
            customColor: '',
            customBw: '',
            pages: Math.floor(Math.random() * 10) + 1 // Mock pages
        });
    }
    
    if (files.length > 0) {
        renderFiles();
        navigate('page-preview');
    }
}

// Render Files
function renderFiles() {
    const container = document.getElementById('file-list');
    const template = document.getElementById('file-item-template').innerHTML;
    
    container.innerHTML = '';
    
    files.forEach(f => {
        let html = template.replace(/{id}/g, f.id);
        const div = document.createElement('div');
        div.innerHTML = html;
        const el = div.firstElementChild;
        
        el.querySelector('.file-name').textContent = f.name;
        el.querySelector('.file-meta').textContent = `${f.pages} Pages • ${f.name.split('.').pop().toUpperCase()}`;
        
        // Setup values
        el.querySelector(`input[value="${f.type}"]`).checked = true;
        el.querySelector('.copies-input').value = f.copies;
        
        // Events
        el.querySelector('.delete-file').onclick = () => {
            files = files.filter(x => x.id !== f.id);
            if (files.length === 0) navigate('page-home');
            else renderFiles();
        };
        
        el.querySelectorAll(`input[name="type_${f.id}"]`).forEach(radio => {
            radio.addEventListener('change', (e) => {
                f.type = e.target.value;
                if (f.type === 'custom') {
                    openCustomPagesModal(f.id);
                }
                updatePrice();
            });
        });
        
        el.querySelector('.minus-copy').onclick = () => {
            if (f.copies > 1) { f.copies--; renderFiles(); }
        };
        el.querySelector('.plus-copy').onclick = () => {
            f.copies++; renderFiles();
        };
        
        el.querySelector('.copies-input').addEventListener('change', (e) => {
            let val = parseInt(e.target.value);
            if (val > 0) f.copies = val;
            renderFiles();
        });
        
        container.appendChild(el);
    });
    
    updatePrice();
}

function updatePrice() {
    let total = 0;
    files.forEach(f => {
        if (f.type === 'bw') total += f.pages * PRICES.bw * f.copies;
        else if (f.type === 'color') total += f.pages * PRICES.color * f.copies;
        else if (f.type === 'custom') {
            // Mock custom calculation
            total += (f.pages / 2) * PRICES.bw * f.copies;
            total += (f.pages / 2) * PRICES.color * f.copies;
        }
    });
    
    document.getElementById('total-price').textContent = `₹${total}`;
    document.getElementById('payment-amount').textContent = `₹${total}`;
}

// Custom Pages Modal
window.openCustomPagesModal = function openCustomPagesModal(id) {
    currentCustomFileId = id;
    const f = files.find(x => x.id === id);
    document.getElementById('custom-file-name').textContent = f.name;
    document.getElementById('custom-color-pages').value = f.customColor;
    document.getElementById('custom-bw-pages').value = f.customBw;
    document.getElementById('modal-custom-pages').classList.add('active');
}

window.closeCustomPagesModal = function closeCustomPagesModal() {
    document.getElementById('modal-custom-pages').classList.remove('active');
}

window.saveCustomPages = function saveCustomPages() {
    if (currentCustomFileId) {
        const f = files.find(x => x.id === currentCustomFileId);
        f.customColor = document.getElementById('custom-color-pages').value;
        f.customBw = document.getElementById('custom-bw-pages').value;
    }
    closeCustomPagesModal();
    updatePrice();
}

// Payment & Success
window.processPayment = async function processPayment() {
    // Prevent multiple clicks
    const btn = document.querySelector('#page-payment .btn-success');
    btn.innerHTML = '<span class="material-icons rotating">sync</span> Processing...';
    btn.disabled = true;

    try {
        // Generate Token
        const token = "A" + Math.floor(Math.random() * 90 + 10);
        const jobId = "job_" + Date.now();
        
        let fileRecords = [];
        
        // Upload Files to Supabase
        for (let f of files) {
            let publicUrl = "";
            if (f.fileObj) {
                const filePath = `${jobId}/${f.name}`;
                const { data, error } = await supabase.storage
                    .from('jobs')
                    .upload(filePath, f.fileObj);
                
                if (error) {
                    throw new Error(`Failed to upload ${f.name}: ${error.message}`);
                }
                
                const { data: urlData } = supabase.storage
                    .from('jobs')
                    .getPublicUrl(filePath);
                    
                publicUrl = urlData.publicUrl;
            }
            
            fileRecords.push({
                name: f.name,
                url: publicUrl,
                type: f.type,
                copies: f.copies,
                pages: f.pages,
                customColor: f.customColor,
                customBw: f.customBw
            });
        }
        
        // Save to Firestore
        await addDoc(collection(db, "jobs"), {
            token: token,
            jobId: jobId,
            files: fileRecords,
            totalPrice: document.getElementById('payment-amount').textContent,
            status: "pending",
            createdAt: serverTimestamp()
        });
        
        document.getElementById('job-token').textContent = token;
        
        // Reset files
        files = [];
        window.navigate('page-success');
    } catch (e) {
        alert("Error processing job: " + e.message);
    } finally {
        btn.innerHTML = '<span class="material-icons">check_circle</span> I have paid';
        btn.disabled = false;
    }
}

// Listen to shop status
onSnapshot(doc(db, "config", "shop"), (docSnap) => {
    if (docSnap.exists()) {
        const data = docSnap.data();
        const statusEl = document.getElementById('shop-status');
        if (data.acceptingJobs) {
            statusEl.className = "status-badge open";
            statusEl.innerHTML = "🟢 Shop Open";
        } else {
            statusEl.className = "status-badge bg-danger text-white";
            statusEl.innerHTML = "🔴 Shop Closed";
        }
    }
});
