document.addEventListener('DOMContentLoaded', () => {
    // --- DATABASE SETUP (VERİTABANI KURULUMU) ---
    const db = new Dexie('AraziHaritamDB');
    db.version(1).stores({
        trees: '++id, title, description, health, pinColor', // Ağaç meta verileri
        images: '++id, treeId, blob' // Resimler ve hangi ağaca ait olduğu
    });

    // --- STATE & CONFIG ---
    let currentPinInfo = null; // Sadece modal'ın hangi pini düzenlediğini tutar
    const imageWidth = 2048;
    const imageHeight = 1536;

    // --- DOM ELEMENT REFERENCES (Tüm elemanlar burada) ---
    const mapElement = document.getElementById('map');
    const pinList = document.getElementById('pin-list');
    const modal = document.getElementById('infoModal');
    const closeButton = document.querySelector('.close-button');
    const titleInput = document.getElementById('modalTitleInput');
    const descriptionTextarea = document.getElementById('modalDescriptionTextarea');
    const healthStatusSelect = document.getElementById('healthStatus');
    const pinColorSelector = document.getElementById('pin-color-selector');
    const imagePreviewContainer = document.getElementById('image-preview-container');
    const galleryUpload = document.getElementById('gallery-upload');
    const cameraUpload = document.getElementById('camera-upload');
    const saveButton = document.getElementById('saveButton');
    const deleteButton = document.getElementById('deleteButton');
    const hamburgerMenu = document.getElementById('hamburger-menu');
    const sidebar = document.getElementById('sidebar');
    const closeSidebar = document.getElementById('close-sidebar');
    const loaderOverlay = document.getElementById('loader-overlay');
    const toastNotification = document.getElementById('toast-notification');

    // --- LEAFLET MAP & ICONS ---
    const map = L.map(mapElement, { crs: L.CRS.Simple, minZoom: -2, maxZoom: 2 });
    const bounds = [[0, 0], [-imageHeight, imageWidth]];
    L.imageOverlay('arazi.jpg', bounds).addTo(map);
    map.fitBounds(bounds);
    // ... ikon oluşturma fonksiyonları aynı...
    const icons = {
        red: createIcon('red'),
        green: createIcon('green'),
        blue: createIcon('blue'),
        grey: createIcon('grey')
    };

    function createIcon(color) {
        return new L.Icon({
            iconUrl: `icons/marker-${color}.png`,
            shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
            iconSize: [25, 41],
            iconAnchor: [12, 41],
            popupAnchor: [1, -34],
            shadowSize: [41, 41]
        });
    }


    // --- HELPER FUNCTIONS ---
    function showLoader() { loaderOverlay.classList.remove('hidden'); }
    function hideLoader() { loaderOverlay.classList.add('hidden'); }
    function showToast(message) {
        toastNotification.textContent = message;
        toastNotification.classList.remove('hidden');
        toastNotification.classList.add('show');
        setTimeout(() => {
            toastNotification.classList.remove('show');
            setTimeout(() => toastNotification.classList.add('hidden'), 300);
        }, 2000);
    }

    // --- UI RENDERING ---
    async function updateUI() {
        const allTrees = await db.trees.toArray();
        renderMarkers(allTrees);
        renderSidebarList(allTrees);
    }

    function renderMarkers(trees) {
        map.eachLayer(layer => { if (layer instanceof L.Marker) map.removeLayer(layer); });
        trees.forEach(tree => {
            const marker = L.marker(tree.coords, { icon: icons[tree.pinColor] || icons.grey }).addTo(map);
            marker.on('click', () => {
                map.flyTo(tree.coords, 2);
                openEditModal(tree.id);
            });
        });
    }

    async function renderSidebarList(trees) {
        pinList.innerHTML = '';
        for (const tree of trees) {
            const listItem = document.createElement('li');
            listItem.className = 'pin-list-item';
            listItem.dataset.id = tree.id;
            
            const firstImage = await db.images.where('treeId').equals(tree.id).first();
            let coverImageSrc = "https://placehold.co/60x60/eeeeee/999999/png?text=Foto+Yok";
            if (firstImage) {
                coverImageSrc = URL.createObjectURL(firstImage.blob);
            }

            listItem.innerHTML = `
                <img src="${coverImageSrc}" class="list-image-preview" alt="${tree.title}">
                <div class="list-item-content">
                    <h3>${tree.title}</h3>
                    <p>${tree.description || "Açıklama yok."}</p> 
                </div>
            `;
            pinList.appendChild(listItem);
            // Not: URL.revokeObjectURL bellek sızıntılarını önlemek için kullanılabilir,
            // ama bu aşamada basitlik için dahil edilmemiştir.
        }
    }

    async function renderImagePreviews(treeId) {
        imagePreviewContainer.innerHTML = '';
        const images = await db.images.where('treeId').equals(treeId).toArray();
        images.forEach(img => {
            const wrapper = document.createElement('div');
            wrapper.className = 'img-preview-wrapper';
            const imgSrc = URL.createObjectURL(img.blob);
            wrapper.innerHTML = `
                <img src="${imgSrc}" class="img-preview">
                <button class="delete-img-btn" data-id="${img.id}">&times;</button>
            `;
            imagePreviewContainer.appendChild(wrapper);
        });
    }

    // --- MODAL & FORM LOGIC ---
    async function openEditModal(id) {
        const tree = await db.trees.get(id);
        if (!tree) return;
        
        currentPinInfo = { id: tree.id, coords: tree.coords };
        titleInput.value = tree.title;
        descriptionTextarea.value = tree.description;
        healthStatusSelect.value = tree.health;
        document.querySelectorAll('.color-dot').forEach(dot => dot.classList.remove('selected'));
        document.querySelector(`.color-dot[data-color="${tree.pinColor}"]`).classList.add('selected');
        
        await renderImagePreviews(tree.id);
        deleteButton.style.display = 'block';
        modal.style.display = 'block';
    }

    function openCreateModal(coords) {
        currentPinInfo = { id: null, coords: coords }; // ID başlangıçta null
        titleInput.value = '';
        descriptionTextarea.value = '';
        healthStatusSelect.value = 'iyi';
        imagePreviewContainer.innerHTML = '';
        document.querySelectorAll('.color-dot').forEach(dot => dot.classList.remove('selected'));
        document.querySelector('.color-dot[data-color="grey"]').classList.add('selected');
        
        deleteButton.style.display = 'none';
        modal.style.display = 'block';
    }
    
    function closeModal() {
        modal.style.display = 'none';
        currentPinInfo = null;
    }

    async function handleSave() {
        if (!currentPinInfo) return;
        showLoader();
        try {
            const selectedColor = document.querySelector('.color-dot.selected').dataset.color;
            const treeObject = {
                title: titleInput.value || "İsimsiz Ağaç",
                description: descriptionTextarea.value,
                health: healthStatusSelect.value,
                pinColor: selectedColor,
                coords: currentPinInfo.coords
            };

            if (currentPinInfo.id) { // Düzenleme modu
                await db.trees.update(currentPinInfo.id, treeObject);
            } else { // Ekleme modu
                const newId = await db.trees.add(treeObject);
                currentPinInfo.id = newId; // Fotoğraf ekleme için ID'yi güncelle
            }
            showToast("Başarıyla kaydedildi!");
        } catch (error) {
            console.error("Kaydetme hatası:", error);
            showToast("Hata: Kaydedilemedi!");
        } finally {
            hideLoader();
            await updateUI();
            closeModal();
        }
    }

    async function handleDelete() {
        if (!currentPinInfo || !currentPinInfo.id) return;
        if (confirm("Bu ağacı ve tüm bilgilerini silmek istediğinizden emin misiniz?")) {
            showLoader();
            try {
                await db.transaction('rw', db.trees, db.images, async () => {
                    await db.images.where('treeId').equals(currentPinInfo.id).delete();
                    await db.trees.delete(currentPinInfo.id);
                });
                showToast("Ağaç başarıyla silindi!");
            } catch (error) {
                console.error("Silme hatası:", error);
                showToast("Hata: Silinemedi!");
            } finally {
                hideLoader();
                await updateUI();
                closeModal();
            }
        }
    }

    // --- IMAGE HANDLING ---
    async function handleImageUpload(files) {
        if (!currentPinInfo || !currentPinInfo.id) {
            alert("Lütfen önce ağaç bilgilerini 'Değişiklikleri Kaydet' diyerek kaydedin, sonra fotoğraf ekleyin.");
            return;
        }

        const imageCount = await db.images.where('treeId').equals(currentPinInfo.id).count();
        if (imageCount + files.length > 10) {
            alert("Bir ağaç için en fazla 10 fotoğraf yükleyebilirsiniz.");
            return;
        }

        if (files.length === 0) return;
        showLoader();
        try {
            const imageObjects = Array.from(files).map(file => ({
                treeId: currentPinInfo.id,
                blob: file // Dosyayı doğrudan Blob olarak sakla
            }));
            await db.images.bulkAdd(imageObjects);
            showToast(`${files.length} fotoğraf eklendi!`);
        } catch (error) {
            console.error("Fotoğraf yükleme hatası:", error);
            showToast("Hata: Fotoğraflar yüklenemedi!");
        } finally {
            await renderImagePreviews(currentPinInfo.id);
            await updateUI();
            hideLoader();
        }
    }

    async function handleDeleteImage(imageId) {
        showLoader();
        try {
            await db.images.delete(imageId);
            showToast("Fotoğraf silindi.");
        } catch (error) {
            console.error("Fotoğraf silme hatası:", error);
            showToast("Hata: Fotoğraf silinemedi!");
        } finally {
            await renderImagePreviews(currentPinInfo.id);
            await updateUI();
            hideLoader();
        }
    }

    // --- EVENT LISTENERS ---
    closeButton.onclick = closeModal;
    saveButton.onclick = handleSave;
    deleteButton.onclick = handleDelete;
    
    map.on('click', e => openCreateModal([e.latlng.lat, e.latlng.lng]));

    pinList.addEventListener('click', async (e) => {
        const listItem = e.target.closest('.pin-list-item');
        if (listItem) {
            const id = parseInt(listItem.dataset.id);
            const tree = await db.trees.get(id);
            if (tree) {
                map.flyTo(tree.coords, 2);
                await openEditModal(id);
                if (window.innerWidth <= 768) sidebar.classList.remove('visible');
            }
        }
    });

    imagePreviewContainer.addEventListener('click', e => {
        if (e.target.classList.contains('delete-img-btn')) {
            const imageId = parseInt(e.target.dataset.id);
            handleDeleteImage(imageId);
        }
    });

    document.getElementById('addFromGallery').onclick = () => galleryUpload.click();
    document.getElementById('addFromCamera').onclick = () => cameraUpload.click();
    galleryUpload.onchange = (e) => handleImageUpload(e.target.files);
    cameraUpload.onchange = (e) => handleImageUpload(e.target.files);
    
    // Diğer tüm event listener'lar (renk seçici, mobil menü) aynı kalabilir
    pinColorSelector.addEventListener('click', e => {
        if (e.target.classList.contains('color-dot')) {
            document.querySelectorAll('.color-dot').forEach(dot => dot.classList.remove('selected'));
            e.target.classList.add('selected');
        }
    });
    hamburgerMenu.onclick = () => sidebar.classList.add('visible');
    closeSidebar.onclick = () => sidebar.classList.remove('visible');

    // --- INITIALIZATION ---
    updateUI();
});