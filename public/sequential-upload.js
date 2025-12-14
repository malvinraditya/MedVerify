document.addEventListener('DOMContentLoaded', () => {
    // Configuration for the sequential upload process
    const steps = [
        { title: 'Foto Depan', instructions: 'Ambil foto bagian depan kemasan obat dengan jelas dan fokus. Pastikan seluruh permukaan depan terlihat.', optional: false },
        { title: 'Foto Belakang', instructions: 'Ambil foto bagian belakang kemasan obat. Fokus pada area yang berisi nomor registrasi, komposisi, dan tanggal kedaluwarsa.', optional: false },
        { title: 'Foto Kiri', instructions: 'Ambil foto sisi kiri kemasan obat. Jika tidak ada informasi penting, Anda bisa melewatkan langkah ini.', optional: true },
        { title: 'Foto Kanan', instructions: 'Ambil foto sisi kanan kemasan obat. Jika tidak ada informasi penting, Anda bisa melewatkan langkah ini.', optional: true }
    ];

    // Application state
    let currentStepIndex = 0;
    const uploadedImages = [];

    // DOM Element references
    const currentStepEl = document.getElementById('currentStep');
    const stepTitleEl = document.getElementById('stepTitle');
    const stepInstructionsEl = document.getElementById('stepInstructions');
    const photoInput = document.getElementById('photoInput');
    const previewImg = document.getElementById('previewImg');
    const uploadPhotoBtn = document.getElementById('uploadPhotoBtn');
    const skipPhotoBtn = document.getElementById('skipPhotoBtn');

    const progressListItems = document.querySelectorAll('#progressList .photo-step-item');
    const uploadSequencePanel = document.getElementById('uploadSequencePanel');
    const completionPanel = document.getElementById('completionPanel');
    const processBtn = document.getElementById('processBtn');
    const loadingOverlay = document.getElementById('loadingOverlay');
    const photoLabel = document.getElementById('photoLabel');

    /**
     * Updates the UI to reflect the current step in the sequence.
     */
    function updateStepUI() {
        // If all steps are completed, show the completion panel
        if (currentStepIndex >= steps.length) {
            uploadSequencePanel.style.display = 'none';
            completionPanel.style.display = 'block';
            return;
        }

        const step = steps[currentStepIndex];

        // Update text content based on the current step
        currentStepEl.textContent = currentStepIndex + 1;
        stepTitleEl.textContent = step.title;
        stepInstructionsEl.textContent = step.instructions;
        photoLabel.textContent = `Unggah ${step.title}`;

        // Reset file input and image preview for the new step
        photoInput.value = '';
        previewImg.style.display = 'none';
        previewImg.src = '';

        // Handle skip button visibility
        if (step.optional) {
            skipPhotoBtn.style.display = 'inline-block'; // Show skip button
        } else {
            skipPhotoBtn.style.display = 'none'; // Hide skip button for mandatory steps
        }



        // Update the visual progress indicator
        progressListItems.forEach((item, index) => {
            const indicator = item.querySelector('.step-indicator');
            if (index < currentStepIndex) {
                // Style for completed steps
                item.style.opacity = '1';
                indicator.style.background = 'var(--color-success)';
                indicator.style.color = '#fff';
                indicator.textContent = '✓';
            } else if (index === currentStepIndex) {
                // Style for the current, active step
                item.style.opacity = '1';
                item.style.fontWeight = '700';
                indicator.style.background = 'rgba(30, 144, 255, 0.2)';
                indicator.style.color = 'var(--color-primary)';
                indicator.textContent = index + 1;
            } else {
                // Style for pending steps
                item.style.opacity = '0.5';
                item.style.fontWeight = 'normal';
                indicator.style.background = 'rgba(30, 144, 255, 0.1)';
                indicator.style.color = 'var(--text-tertiary)';
                indicator.textContent = index + 1;
            }
        });
    }

    /**
     * Handles the file input change event to show a preview of the selected image.
     */
    photoInput.addEventListener('change', () => {
        if (photoInput.files && photoInput.files[0]) {
            const reader = new FileReader();
            reader.onload = (e) => {
                previewImg.src = e.target.result;
                previewImg.style.display = 'block';
            };
            reader.readAsDataURL(photoInput.files[0]);
        }
    });

    /**
     * Handles the 'Upload & Continue' button click.
     * This function would typically include file upload logic.
     */
    uploadPhotoBtn.addEventListener('click', () => {
        const currentStep = steps[currentStepIndex];

        if (!photoInput.files || photoInput.files.length === 0) {
            if (!currentStep.optional) {
                alert('Silakan pilih file untuk diunggah.');
                return;
            } else {
                // If optional and no file selected, proceed as a skip
                console.log(`Skipping upload for optional step ${currentStepIndex + 1}: ${currentStep.title}`);
                uploadedImages.push({
                    step: currentStep.title,
                    file: null // Mark as skipped
                });
                currentStepIndex++;
                updateStepUI();
                return;
            }
        }

        const file = photoInput.files[0];
        
        // In a real application, you would upload the file to a server here.
        // For this fix, we'll just simulate it by storing the file info.
        uploadedImages.push({
            step: currentStep.title,
            file: file
        });
        
        console.log(`Simulating upload of ${file.name} for step ${currentStepIndex + 1}`);

        // Move to the next step
        currentStepIndex++;
        updateStepUI();
    });

    /**
     * Handles the 'Lewati' (Skip) button click for optional photos.
     */
    skipPhotoBtn.addEventListener('click', () => {
        const currentStep = steps[currentStepIndex];
        if (currentStep.optional) {
            console.log(`Skipping upload for optional step ${currentStepIndex + 1}: ${currentStep.title}`);
            uploadedImages.push({
                step: currentStep.title,
                file: null // Mark as skipped
            });
            currentStepIndex++;
            updateStepUI();
        } else {
            alert('Langkah ini tidak bisa dilewati. Harap unggah foto.');
        }
    });



    /**
     * Handles the 'Start AI Analysis' button click after all photos are handled.
     */
    processBtn.addEventListener('click', async () => {
        if (loadingOverlay) {
            loadingOverlay.style.display = 'flex';
        }

        try {
            // Step 1: Start a new scan job to get a scanId
            console.log('Starting new scan...');
            const startResponse = await fetch('/api/scan/start', { method: 'POST' });
            if (!startResponse.ok) throw new Error('Failed to start scan session.');
            
            const { scanId } = await startResponse.json();
            console.log(`Scan session started with ID: ${scanId}`);

            // Step 2: Upload each photo that was provided
            const uploadPromises = uploadedImages.map(imgData => {
                if (imgData.file) {
                    const formData = new FormData();
                    const photoType = getPhotoType(imgData.step);
                    
                    formData.append('photo', imgData.file);
                    formData.append('photoType', photoType);

                    console.log(`Uploading ${photoType} photo...`);
                    return fetch(`/api/scan/${scanId}/photo`, {
                        method: 'POST',
                        body: formData,
                    }).then(res => {
                        if (!res.ok) return res.json().then(err => { throw new Error(`Upload failed for ${photoType}: ${err.message}`) });
                        console.log(`${photoType} photo uploaded successfully.`);
                        return res.json();
                    });
                }
                return Promise.resolve(null); // Resolve null for skipped photos
            });

            await Promise.all(uploadPromises);
            console.log('All photos processed.');

            // Step 3: Finalize the scan
            console.log('Finalizing scan...');
            const finishResponse = await fetch(`/api/scan/${scanId}/finish`, { method: 'POST' });
            if (!finishResponse.ok) throw new Error('Failed to finalize scan.');

            const finalResult = await finishResponse.json();
            console.log('Scan finalized:', finalResult);

            // Step 4: Redirect to the results page
            window.location.href = `/results.html?scanId=${scanId}`;

        } catch (error) {
            console.error('An error occurred during the analysis process:', error);
            alert(`Terjadi kesalahan: ${error.message}`);
            if (loadingOverlay) {
                loadingOverlay.style.display = 'none';
            }
        }
    });

    /**
     * Maps the step title to the API's expected photoType.
     * @param {string} stepTitle - The title of the step (e.g., 'Foto Depan').
     * @returns {string} The corresponding photo type (e.g., 'front').
     */
    function getPhotoType(stepTitle) {
        switch (stepTitle) {
            case 'Foto Depan': return 'front';
            case 'Foto Belakang': return 'back';
            case 'Foto Kiri': return 'left';
            case 'Foto Kanan': return 'right';
            default: return 'unknown';
        }
    }

    // Initial call to set up the UI for the first step
    updateStepUI();
});
