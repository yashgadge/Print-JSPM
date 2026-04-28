import { db, storage } from "./firebase-config.js";
import { collection, addDoc, serverTimestamp, doc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js";

// State
let files = [];
let currentCustomFileId = null;

let PRICES = { bw: 2, color: 10 };

// Real-time Pricing Fetch
onSnapshot(doc(db, "config", "shop"), (snapshot) => {
    if (snapshot.exists()) {
        const data = snapshot.data();
        if (data.prices) {
            PRICES = {
                bw: data.prices.bw || 2,
                color: data.prices.color || 10
            };
            if (files.length > 0) renderFiles(); // Update UI if prices change
        }
    }
});

// Navigation
window.navigate = function navigate(pageId) {
    if (pageId === 'page-payment') {
        let summaryHtml = '';
        files.forEach(f => {
            let colorCount = 0;
            let bwCount = 0;
            let cCost = 0;
            let bCost = 0;
            
            if (f.type === 'bw') {
                bwCount = f.pages;
                bCost = bwCount * PRICES.bw * f.copies;
            } else if (f.type === 'color') {
                colorCount = f.pages;
                cCost = colorCount * PRICES.color * f.copies;
            } else if (f.type === 'custom') {
                colorCount = f.customColorArray ? f.customColorArray.length : 0;
                bwCount = f.customBwArray ? f.customBwArray.length : 0;
                cCost = colorCount * PRICES.color * f.copies;
                bCost = bwCount * PRICES.bw * f.copies;
            }
            
            let totalItem = cCost + bCost;
            
            summaryHtml += `
                <div style="border-bottom: 1px solid #ccc; padding-bottom: 8px; margin-bottom: 8px;">
                    <strong>${f.name}</strong> (x${f.copies})<br>
                    <span style="color:#666; font-size:0.8rem;">
                        Total Pages: ${f.pages} | Print Mode: ${f.type.toUpperCase()}<br>
                        Color: ${colorCount} | B/W: ${bwCount}<br>
                        Subtotal: ₹${totalItem}
                    </span>
                </div>
            `;
        });
        document.getElementById('job-summary-container').innerHTML = summaryHtml || 'No files selected.';
    }

    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById(pageId).classList.add('active');
    window.scrollTo(0, 0);
}

// File Upload
document.getElementById('file-upload').addEventListener('change', function(e) {
    const selectedFiles = Array.from(e.target.files);
    handleNewFiles(selectedFiles);
    // Clear value so same file can be selected again
    e.target.value = '';
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

async function handleNewFiles(newFiles) {
    try {
        // Validation for abuse prevention
        if (files.length + newFiles.length > 5) {
            alert("Maximum 5 files allowed per job to prevent system abuse.");
            return;
        }
        
        const allowedTypes = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'text/plain', 'image/jpeg', 'image/png', 'image/jpg'];
        
        for (let f of newFiles) {
            if (!allowedTypes.includes(f.type)) {
                alert(`${f.name} is an unsupported file type. (Use PDF, DOCX, PPT, JPG, PNG)`);
                continue;
            }
            if (f.size > 100 * 1024 * 1024) { // Increased to 100MB
                alert(`${f.name} is too large (Max 100MB)`);
                continue;
            }
            
            let pagesCount = 1;
            if (f.type === 'application/pdf') {
                try {
                    const url = URL.createObjectURL(f);
                    const pdf = await pdfjsLib.getDocument(url).promise;
                    pagesCount = pdf.numPages;
                    URL.revokeObjectURL(url);
                } catch (e) {
                    console.error("Failed to parse PDF page count", e);
                    pagesCount = 1;
                }
            }
            
            files.push({
                id: 'file_' + Date.now() + Math.random().toString(36).substr(2, 9),
                name: f.name,
                fileObj: f,
                type: 'bw', // default bw
                copies: 1,
                customColor: '',
                customBw: '',
                pages: pagesCount,
                imageLayout: 'full',
                imageOrient: 'portrait',
                imageFit: true
            });
        }
        
        if (files.length > 0) {
            navigate('page-preview');
            renderFiles();
            // Auto-check the first file for preview to show something immediately
            setTimeout(() => {
                const firstCheck = document.querySelector('.file-preview-checkbox');
                if (firstCheck) {
                    firstCheck.checked = true;
                    renderMainPDFPreview();
                }
            }, 100);
        }
    } catch (err) {
        alert("Error processing files: " + err.message);
        console.error(err);
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
                renderMainPDFPreview();
            });
            
            // Allow reopening the modal by clicking the Custom option if it's already selected
            if (radio.value === 'custom') {
                const label = el.querySelector(`label[for="${radio.id}"]`);
                if (label) {
                    label.addEventListener('click', (e) => {
                        if (f.type === 'custom') {
                            e.preventDefault();
                            openCustomPagesModal(f.id);
                        }
                    });
                }
            }
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

        // Image Options Setup - Robust detection
        const isImage = f.name.match(/\.(jpg|jpeg|png|webp)$/i) || (f.fileObj && f.fileObj.type && f.fileObj.type.startsWith('image/'));
        
        const thumb = el.querySelector('.file-item-preview-thumb');
        if (isImage) {
            thumb.style.display = 'flex';
            const img = document.createElement('img');
            img.src = URL.createObjectURL(f.fileObj);
            img.style.width = '100%';
            img.style.height = '100%';
            img.style.objectFit = f.imageFit !== false ? 'cover' : 'contain';
            
            // Rotation feedback
            if (f.imageOrient === 'landscape') {
                img.style.transform = 'rotate(90deg) scale(0.7)';
                img.style.border = '2px solid var(--primary)';
            }
            if (f.type === 'bw') img.style.filter = 'grayscale(100%)';
            
            thumb.innerHTML = '';
            thumb.appendChild(img);
            
            // If combined, show a badge
            if ((f.combinedFiles || []).length > 0) {
                const badge = document.createElement('div');
                badge.textContent = `+${f.combinedFiles.length}`;
                badge.style.position = 'absolute';
                badge.style.background = 'var(--primary)';
                badge.style.color = 'white';
                badge.style.fontSize = '10px';
                badge.style.padding = '2px 4px';
                badge.style.borderRadius = '4px';
                badge.style.bottom = '2px';
                badge.style.right = '2px';
                thumb.style.position = 'relative';
                thumb.appendChild(badge);
            }

            const imgBox = el.querySelector('.image-options-box');
            imgBox.style.display = 'block'; // Force display
            imgBox.classList.remove('hidden');
            imgBox.style.background = '#f9f9f9';
            imgBox.style.padding = '10px';
            imgBox.style.borderRadius = '8px';
            imgBox.style.border = '1px solid #eee';
            
            // Sync current state
            const layoutSelect = el.querySelector('.image-layout-select');
            layoutSelect.value = f.imageLayout || 'full';
            
            const orientVal = f.imageOrient || 'portrait';
            const orientInput = el.querySelector(`input[name="orient_${f.id}"][value="${orientVal}"]`);
            if (orientInput) orientInput.checked = true;
            
            const fitCheck = el.querySelector('.image-fit-check');
            fitCheck.checked = f.imageFit !== false;
            
            // Listeners
            layoutSelect.onchange = (e) => {
                f.imageLayout = e.target.value;
                renderMainPDFPreview();
            };
            el.querySelectorAll(`input[name="orient_${f.id}"]`).forEach(r => {
                r.onchange = (e) => {
                    f.imageOrient = e.target.value;
                    renderMainPDFPreview();
                };
            });
            fitCheck.onchange = (e) => {
                f.imageFit = e.target.checked;
                renderMainPDFPreview();
            };

            // Update slots
            updateSlotPicker(f.id, el);
        }
        
        el.querySelector('.file-preview-checkbox').addEventListener('change', () => {
            renderMainPDFPreview();
        });
        
        container.appendChild(el);
    });
    
    updatePrice();
}

function updateSlotPicker(fileId, el) {
    const f = files.find(x => x.id === fileId);
    const container = el.querySelector('.slot-picker-container');
    const slotList = el.querySelector('.slot-list');
    
    const isMulti = ['2x1', '2x2', 'merge'].includes(f.imageLayout);
    if (!isMulti) {
        container.classList.add('hidden');
        return;
    }
    
    container.classList.remove('hidden');
    slotList.innerHTML = '';
    
    const otherImages = files.filter(x => x.id !== fileId && (x.name.match(/\.(jpg|jpeg|png|webp)$/i) || (x.fileObj && x.fileObj.type && x.fileObj.type.startsWith('image/'))));
    
    if (otherImages.length === 0) {
        slotList.innerHTML = '<span style="font-size:0.75rem; color:#999;">No other photos uploaded yet.</span>';
        return;
    }
    
    otherImages.forEach(other => {
        const item = document.createElement('div');
        item.style.display = 'flex';
        item.style.alignItems = 'center';
        item.style.gap = '8px';
        item.style.fontSize = '0.85rem';
        item.style.padding = '2px 0';
        
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.style.width = '16px';
        cb.style.height = '16px';
        cb.checked = (f.combinedFiles || []).includes(other.id);
        cb.onchange = (e) => {
            if (!f.combinedFiles) f.combinedFiles = [];
            if (e.target.checked) {
                if (!f.combinedFiles.includes(other.id)) f.combinedFiles.push(other.id);
            } else {
                f.combinedFiles = f.combinedFiles.filter(id => id !== other.id);
            }
            renderMainPDFPreview();
        };
        
        const lbl = document.createElement('label');
        lbl.textContent = other.name;
        lbl.style.cursor = 'pointer';
        lbl.onclick = () => cb.click();
        
        item.appendChild(cb);
        item.appendChild(lbl);
        slotList.appendChild(item);
    });
}

function updatePrice() {
    let total = 0;
    files.forEach(f => {
        if (f.type === 'bw') total += f.pages * PRICES.bw * f.copies;
        else if (f.type === 'color') total += f.pages * PRICES.color * f.copies;
        else if (f.type === 'custom') {
            let colorCount = f.customColorArray ? f.customColorArray.length : 0;
            let bwCount = f.customBwArray ? f.customBwArray.length : 0;
            total += colorCount * PRICES.color * f.copies;
            total += bwCount * PRICES.bw * f.copies;
        }
    });
    
    document.getElementById('total-price').textContent = `₹${total}`;
    document.getElementById('payment-amount').textContent = `₹${total}`;
}

// Custom Pages System
let previewTimeout = null;
let currentCustomTotalPages = 0;
let tempColorArray = [];
let tempBwArray = [];

window.openCustomPagesModal = async function openCustomPagesModal(id) {
    currentCustomFileId = id;
    const f = files.find(x => x.id === id);
    currentCustomTotalPages = f.pages;
    
    document.getElementById('custom-file-name').textContent = f.name;
    document.getElementById('custom-color-pages').value = f.customColor || "";
    document.getElementById('custom-bw-pages').value = f.customBw || "";
    document.getElementById('modal-custom-pages').classList.add('active');
    
    // Auto-expand only on desktop to avoid covering inputs on mobile
    if (window.innerWidth > 768) {
        document.getElementById('preview-side-panel').classList.add('expanded');
    } else {
        document.getElementById('preview-side-panel').classList.remove('expanded');
    }
    
    updateCustomPreviewAndValidation();
}

window.closeCustomPagesModal = function closeCustomPagesModal() {
    document.getElementById('modal-custom-pages').classList.remove('active');
    document.getElementById('preview-side-panel').classList.remove('expanded');
}

function parsePageRanges(input) {
    if (!input || !input.trim()) return [];
    let pages = new Set();
    const parts = input.replace(/\s+/g, '').split(',');
    for (const part of parts) {
        if (!part) continue;
        if (part.includes('-')) {
            const [startStr, endStr] = part.split('-');
            const start = parseInt(startStr);
            const end = parseInt(endStr);
            if (!isNaN(start) && !isNaN(end) && start <= end) {
                for (let i = start; i <= end; i++) pages.add(i);
            }
        } else {
            const num = parseInt(part);
            if (!isNaN(num)) pages.add(num);
        }
    }
    return Array.from(pages).sort((a, b) => a - b);
}

function updateCustomPreviewAndValidation() {
    const errorEl = document.getElementById('custom-pages-error');
    errorEl.classList.add('hidden');
    document.getElementById('btn-save-custom').disabled = true;

    const colorInput = document.getElementById('custom-color-pages').value;
    const bwInput = document.getElementById('custom-bw-pages').value;

    let cPages = parsePageRanges(colorInput);
    let bPages = parsePageRanges(bwInput);

    // Validate bounds
    let outOfBounds = cPages.find(p => p < 1 || p > currentCustomTotalPages) || 
                      bPages.find(p => p < 1 || p > currentCustomTotalPages);
    
    if (outOfBounds) {
        errorEl.textContent = `Error: Page ${outOfBounds} does not exist (Total pages: ${currentCustomTotalPages})`;
        errorEl.classList.remove('hidden');
        return;
    }

    // Overlap resolution removed: User can print the same page in both color and B/W
    

    tempColorArray = cPages;
    tempBwArray = bPages;

    const totalValid = cPages.length + bPages.length;
    if (totalValid === 0 && (colorInput.trim() !== '' || bwInput.trim() !== '')) {
        errorEl.textContent = `Error: No valid pages selected.`;
        errorEl.classList.remove('hidden');
        return;
    }

    document.getElementById('custom-selected-pages').textContent = totalValid > 0 ? Array.from(new Set([...cPages, ...bPages])).sort((a,b)=>a-b).join(', ') : 'None';
    document.getElementById('custom-total-valid').textContent = totalValid;
    document.getElementById('custom-color-count').textContent = cPages.length;
    document.getElementById('custom-bw-count').textContent = bPages.length;
    
    document.getElementById('side-selected-pages').textContent = totalValid > 0 ? `Selected: ${Array.from(new Set([...cPages, ...bPages])).sort((a,b)=>a-b).join(', ')}` : 'Selected: None';
    document.getElementById('side-total-pages').textContent = `Total: ${totalValid} pages`;
    
    const estCost = (cPages.length * PRICES.color) + (bPages.length * PRICES.bw);
    document.getElementById('custom-estimated-cost').textContent = `₹${estCost}`;

    if (totalValid > 0) {
        document.getElementById('btn-save-custom').disabled = false;
        renderCustomPDFPreview(cPages, bPages);
    } else {
        document.getElementById('custom-pdf-preview').innerHTML = '<span style="color: #888; font-size: 0.9rem; margin: auto;">Enter pages above to see preview</span>';
    }
}

async function renderCustomPDFPreview(colorPages, bwPages) {
    const container = document.getElementById('custom-pdf-preview');
    container.innerHTML = '<span style="color: #888; font-size: 0.9rem; margin: auto;">Loading preview...</span>';
    
    const f = files.find(x => x.id === currentCustomFileId);
    if (!f || !f.fileObj) return;

    let allSelected = Array.from(new Set([...colorPages, ...bwPages])).sort((a, b) => a - b);
    let previewPages = allSelected.slice(0, 10); // Max 10

    try {
        const fileURL = URL.createObjectURL(f.fileObj);
        const pdf = await pdfjsLib.getDocument(fileURL).promise;
        container.innerHTML = '';
        
        for (let pageNum of previewPages) {
            const page = await pdf.getPage(pageNum);
            const viewport = page.getViewport({ scale: 0.5 });
            
            const wrapper = document.createElement('div');
            wrapper.className = 'preview-card';
            
            const canvas = document.createElement('canvas');
            const context = canvas.getContext('2d');
            canvas.height = viewport.height;
            canvas.width = viewport.width;
            canvas.style.boxShadow = "0px 2px 4px rgba(0,0,0,0.1)";
            
            const renderContext = { canvasContext: context, viewport: viewport };
            await page.render(renderContext).promise;
            
            const isColor = colorPages.includes(pageNum);
            const isBw = bwPages.includes(pageNum);
            let typeStr = [];
            if (isColor) typeStr.push('Color');
            if (isBw) typeStr.push('B/W');
            
            const label = document.createElement('div');
            label.className = 'preview-card-label';
            label.textContent = `Page ${pageNum} - ${typeStr.join(' & ')}`;
            label.style.color = isColor ? 'var(--primary)' : '#555';
            
            // Grayscale effect for BW (only if it's strictly BW)
            if (!isColor && isBw) canvas.style.filter = "grayscale(100%)";
            
            wrapper.appendChild(canvas);
            wrapper.appendChild(label);
            container.appendChild(wrapper);
        }
        
        if (allSelected.length > 10) {
            const extra = document.createElement('div');
            extra.innerHTML = `+ ${allSelected.length - 10} more...`;
            extra.style.margin = 'auto';
            extra.style.fontWeight = 'bold';
            container.appendChild(extra);
        }
    } catch (e) {
        container.innerHTML = `<span class="text-danger">Failed to load preview: ${e.message}</span>`;
    }
}

document.getElementById('custom-color-pages').addEventListener('input', () => {
    clearTimeout(previewTimeout);
    previewTimeout = setTimeout(updateCustomPreviewAndValidation, 300);
});

document.getElementById('custom-bw-pages').addEventListener('input', () => {
    clearTimeout(previewTimeout);
    previewTimeout = setTimeout(updateCustomPreviewAndValidation, 300);
});

window.togglePreviewPanel = function() {
    const panel = document.getElementById('preview-side-panel');
    panel.classList.toggle('expanded');
};

window.saveCustomPages = function saveCustomPages() {
    if (currentCustomFileId) {
        const f = files.find(x => x.id === currentCustomFileId);
        f.customColor = document.getElementById('custom-color-pages').value;
        f.customBw = document.getElementById('custom-bw-pages').value;
        f.customColorArray = tempColorArray;
        f.customBwArray = tempBwArray;
    }
    closeCustomPagesModal();
    updatePrice();
    renderMainPDFPreview();
}

// Payment & Success
window.triggerRazorpay = async function triggerRazorpay() {
    const amountStr = document.getElementById('payment-amount').textContent.replace('₹', '');
    const amount = (parseFloat(amountStr) || 0) * 100; // paise
    
    if (amount <= 0) return alert("Amount cannot be zero.");

    const btn = document.getElementById('btn-pay-razorpay');
    btn.innerHTML = '<span class="material-icons rotating">sync</span> Loading...';
    btn.disabled = true;
    document.getElementById('btn-back-payment').disabled = true;

    try {
        // Call backend to create order
        const res = await fetch('/api/createOrder', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ amount: amount })
        });
        const data = await res.json();
        
        if(!data.order_id) throw new Error("Failed to create order");

        var options = {
            "key": "rzp_test_SisJdz2YlHwXnF",
            "amount": amount,
            "currency": "INR",
            "name": "Smart Xerox",
            "description": "Print Job Payment",
            "order_id": data.order_id,
            "handler": async function (response) {
                // Payment success in UI, verify in backend
                document.getElementById('razorpay-container').classList.add('hidden');
                const confirmBtn = document.getElementById('btn-confirm-payment');
                confirmBtn.classList.remove('hidden');
                confirmBtn.innerHTML = '<span class="material-icons rotating">sync</span> Verifying Payment...';
                
                await verifyAndSaveJob(response.razorpay_order_id, response.razorpay_payment_id, response.razorpay_signature);
            },
            "theme": { "color": "#0d6efd" }
        };
        var rzp1 = new Razorpay(options);
        rzp1.on('payment.failed', function (response){
            alert("Payment failed: " + response.error.description);
        });
        rzp1.open();
    } catch(e) {
        alert("Error: " + e.message);
    } finally {
        btn.innerHTML = '<span class="material-icons">payment</span> Pay with Razorpay';
        btn.disabled = false;
        document.getElementById('btn-back-payment').disabled = false;
    }
}

window.bypassPayment = async function bypassPayment() {
    document.getElementById('razorpay-container').classList.add('hidden');
    const confirmBtn = document.getElementById('btn-confirm-payment');
    confirmBtn.classList.remove('hidden');
    confirmBtn.innerHTML = '<span class="material-icons rotating">sync</span> Bypassing Payment...';
    
    await verifyAndSaveJob("test_bypass", "test_bypass", "test_bypass");
}

async function verifyAndSaveJob(order_id, payment_id, signature) {
    try {
        const token = "A" + Math.floor(Math.random() * 90 + 10);
        const jobId = "job_" + Date.now();
        
        // 1. Upload files first
        let fileRecords = [];
        for (let f of files) {
            let publicUrl = "";
            if (f.fileObj) {
                const filePath = `jobs/${jobId}/${f.name}`;
                const storageRef = ref(storage, filePath);
                
                try {
                    await uploadBytes(storageRef, f.fileObj);
                    publicUrl = await getDownloadURL(storageRef);
                } catch (error) {
                    throw new Error(`Failed to upload ${f.name}: ${error.message}`);
                }
            }
            
            fileRecords.push({
                name: f.name,
                url: publicUrl,
                type: f.type,
                copies: f.copies,
                pages: f.pages,
                customColor: f.customColor,
                customBw: f.customBw,
                customColorArray: f.customColorArray || [],
                customBwArray: f.customBwArray || [],
                // Image specific
                imageLayout: f.imageLayout || 'full',
                imageOrient: f.imageOrient || 'portrait',
                imageFit: f.imageFit !== false,
                combinedFiles: f.combinedFiles || []
            });
        }
        
        // 2. Prepare Job Data for backend verification
        const jobData = {
            token: token,
            jobId: jobId,
            files: fileRecords,
            totalPrice: document.getElementById('payment-amount').textContent,
            status: "pending"
        };
        
        // 3. Call verification API
        const res = await fetch('/api/verifyPayment', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                razorpay_order_id: order_id,
                razorpay_payment_id: payment_id,
                razorpay_signature: signature,
                jobData: jobData
            })
        });
        
        const data = await res.json();
        
        if(data.success) {
            document.getElementById('job-token').textContent = token;
            files = [];
            window.navigate('page-success');
        } else {
            throw new Error(data.error || "Verification failed");
        }
        
    } catch (e) {
        alert("Error completing job: " + e.message);
        document.getElementById('btn-confirm-payment').innerHTML = '<span class="material-icons">error</span> Verification Failed. Try Again.';
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

window.renderMainPDFPreview = async function() {
    const checkboxes = document.querySelectorAll('.file-preview-checkbox:checked');
    const panel = document.getElementById('preview-side-panel');
    const container = document.getElementById('custom-pdf-preview');
    
    if (checkboxes.length === 0) {
        panel.classList.remove('expanded');
        container.innerHTML = '<div style="text-align: center; color: #888; margin-top: 2rem;">Select files using the checkboxes to see a global preview.</div>';
        document.getElementById('side-selected-pages').textContent = 'Selected: None';
        document.getElementById('side-total-pages').textContent = 'Total: 0 files';
        return;
    }
    
    // Always expand the panel when something is selected, even on mobile
    panel.classList.add('expanded');
    
    document.getElementById('side-selected-pages').textContent = `Selected: ${checkboxes.length} file(s)`;
    document.getElementById('side-total-pages').textContent = 'Global Preview';
    
    container.innerHTML = '<span style="color: #888; font-size: 0.9rem; margin: auto;">Loading previews...</span>';
    
    const wrapperHTML = [];
    
    for (let cb of checkboxes) {
        const fileId = cb.getAttribute('data-id');
        const f = files.find(x => x.id === fileId);
        if (!f || !f.fileObj) continue;
        
        const fileURL = URL.createObjectURL(f.fileObj);
        
        // Add File Header
        const fileHeader = document.createElement('div');
        fileHeader.innerHTML = `<h4 style="margin:0; font-size:1rem; color:var(--primary);"><span class="material-icons" style="font-size:1.2rem; vertical-align:middle; margin-right:5px;">description</span>${f.name}</h4>
                                <div style="font-size:0.8rem; color:#666; margin-top:2px;">Type: ${f.type.toUpperCase()}</div>`;
        fileHeader.style.marginTop = '1.5rem';
        fileHeader.style.marginBottom = '1rem';
        fileHeader.style.padding = '0.75rem';
        fileHeader.style.background = '#fff';
        fileHeader.style.border = '1px solid var(--border)';
        fileHeader.style.borderRadius = 'var(--radius-md)';
        fileHeader.style.boxShadow = 'var(--shadow-sm)';
        fileHeader.style.width = '100%';
        fileHeader.style.position = 'sticky';
        fileHeader.style.top = '0';
        fileHeader.style.zIndex = '10';
        wrapperHTML.push(fileHeader);

        if (f.fileObj.type.startsWith('image/')) {
            const imgWrapper = document.createElement('div');
            imgWrapper.className = 'preview-card';
            imgWrapper.style.padding = '10px';
            
            const img = document.createElement('img');
            img.src = fileURL;
            img.style.maxWidth = '100%';
            img.style.height = '150px'; // Fixed height for consistency in grid
            img.style.borderRadius = '4px';
            img.style.boxShadow = "0px 2px 4px rgba(0,0,0,0.1)";
            
            // Apply "Fit to Frame" logic
            if (f.imageFit !== false) {
                img.style.objectFit = 'cover'; // Cropped to fill
            } else {
                img.style.objectFit = 'contain'; // Whole image visible
                img.style.background = "#eee";
            }
            
            // Visual feedback for orientation
            if (f.imageOrient === 'landscape') {
                img.style.transform = "rotate(-5deg)"; // Subtle tilt to show it's landscape-intended
                img.style.border = "3px solid var(--primary)";
            }
            
            if (f.type === 'bw') img.style.filter = "grayscale(100%)";
            
            const label = document.createElement('div');
            label.className = 'preview-card-label';
            
            let layoutText = "Full Page";
            if(f.imageLayout === '2x1') layoutText = "13x18 (2/pg)";
            if(f.imageLayout === '1x1') layoutText = "20x25 (1/pg)";
            if(f.imageLayout === '2x2') layoutText = "10x15 (4/pg)";
            if(f.imageLayout === 'merge') layoutText = "Merge Layout";

            const combinedCount = (f.combinedFiles || []).length;
            const combinedText = combinedCount > 0 ? ` (+ ${combinedCount} others)` : '';

            label.innerHTML = `<strong>${layoutText}${combinedText}</strong><br>${f.imageOrient.toUpperCase()} • ${f.imageFit !== false ? 'Fitted' : 'Full'}`;
            label.style.fontSize = "0.75rem";
            
            imgWrapper.appendChild(img);
            imgWrapper.appendChild(label);
            wrapperHTML.push(imgWrapper);
            continue;
        }

        try {
            const pdf = await pdfjsLib.getDocument(fileURL).promise;
            
            let pagesToRender = [];
            if (f.type === 'custom') {
                const cPages = parsePageRanges(f.customColor).filter(p => p > 0 && p <= pdf.numPages);
                const bPages = parsePageRanges(f.customBw).filter(p => p > 0 && p <= pdf.numPages);
                const allSelected = Array.from(new Set([...cPages, ...bPages])).sort((a,b)=>a-b);
                for (let p of allSelected) {
                    const isColor = cPages.includes(p);
                    const isBw = bPages.includes(p);
                    let typeStr = [];
                    if (isColor) typeStr.push('Color');
                    if (isBw) typeStr.push('B/W');
                    
                    pagesToRender.push({
                        pageNum: p,
                        isBw: !isColor && isBw,
                        labelStr: `Page ${p} - ${typeStr.join(' & ')}`,
                        labelColor: isColor ? 'var(--primary)' : '#555'
                    });
                }
                if (allSelected.length === 0) {
                    const emptyMsg = document.createElement('div');
                    emptyMsg.style.color = '#888';
                    emptyMsg.style.fontSize = '0.9rem';
                    emptyMsg.style.margin = '1rem auto';
                    emptyMsg.textContent = 'No valid custom pages selected.';
                    wrapperHTML.push(emptyMsg);
                }
            } else {
                for (let i = 1; i <= pdf.numPages; i++) {
                    pagesToRender.push({
                        pageNum: i,
                        isBw: f.type === 'bw',
                        labelStr: `Page ${i}`,
                        labelColor: '#555'
                    });
                }
            }
            
            const observer = new IntersectionObserver((entries, obs) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        const target = entry.target;
                        if (target.dataset.rendered === 'true') return;
                        target.dataset.rendered = 'true';
                        
                        const pageNum = parseInt(target.dataset.pageNum);
                        const isBw = target.dataset.isBw === 'true';
                        
                        pdf.getPage(pageNum).then(page => {
                            const viewport = page.getViewport({ scale: 0.4 });
                            const canvas = document.createElement('canvas');
                            const context = canvas.getContext('2d');
                            canvas.height = viewport.height;
                            canvas.width = viewport.width;
                            canvas.style.boxShadow = "0px 2px 4px rgba(0,0,0,0.1)";
                            if (isBw) canvas.style.filter = "grayscale(100%)";
                            
                            target.innerHTML = ''; 
                            target.appendChild(canvas);
                            
                            const label = document.createElement('div');
                            label.className = 'preview-card-label';
                            label.textContent = target.dataset.labelStr;
                            label.style.color = target.dataset.labelColor;
                            target.appendChild(label);
                            
                            const renderContext = { canvasContext: context, viewport: viewport };
                            page.render(renderContext);
                        }).catch(e => {
                            target.innerHTML = '<span class="text-danger" style="font-size:0.8rem">Failed to load</span>';
                        });
                        
                        obs.unobserve(target);
                    }
                });
            }, { rootMargin: '500px' }); // Removed 'root' to use viewport, increased margin
            
            for (let pageInfo of pagesToRender) {
                const wrapper = document.createElement('div');
                wrapper.className = 'preview-card';
                wrapper.style.minHeight = '150px'; 
                wrapper.style.display = 'flex';
                wrapper.style.flexDirection = 'column';
                wrapper.style.alignItems = 'center';
                wrapper.style.justifyContent = 'center';
                wrapper.dataset.pageNum = pageInfo.pageNum;
                wrapper.dataset.isBw = pageInfo.isBw;
                wrapper.dataset.labelStr = pageInfo.labelStr;
                wrapper.dataset.labelColor = pageInfo.labelColor;
                wrapper.dataset.rendered = 'false';
                
                const loader = document.createElement('span');
                loader.className = 'material-icons rotating';
                loader.textContent = 'sync';
                loader.style.color = '#ccc';
                wrapper.appendChild(loader);
                
                wrapperHTML.push(wrapper);
                
                observer.observe(wrapper);
            }
            
        } catch (e) {
            console.error("Preview failed for", f.name, e);
        }
    }
    
    container.innerHTML = '';
    wrapperHTML.forEach(el => container.appendChild(el));
};
