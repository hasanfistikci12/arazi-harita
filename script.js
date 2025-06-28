document.addEventListener('DOMContentLoaded', () => {
    // --------------------------------------------------------------------
    // KENDİ FIREBASE VE MAPBOX BİLGİLERİNİZİ BURAYA YAPIŞTIRIN
    // --------------------------------------------------------------------
    const firebaseConfig = {
        apiKey: "AIzaSyB38rAHCtL_5QCJCut9AkaMFsEFBmk9Zco",
        authDomain: "arazi-maps.firebaseapp.com",
        projectId: "arazi-maps",
        storageBucket: "arazi-maps.firebasestorage.app",
        messagingSenderId: "851218950638",
        appId: "1:851218950638:web:92aee6b90cb562610ec6ff"
    };

    const MAPBOX_ACCESS_TOKEN = 'pk.eyJ1IjoiaGFzYW5maXN0aWtjaSIsImEiOiJjbWNmaHQ4NHEwYWE2MmlzaXpxOWhya2U3In0.Zz--FFAQHeGkwPtsWEULug';
    
    const LAND_COORDINATES = [37.384983, 37.794709]; 

    // Firebase'i başlat
    firebase.initializeApp(firebaseConfig);
    const db = firebase.firestore();
    const storage = firebase.storage();

    // --- STATE & CONFIG ---
    let currentPinInfo = null;
    let localTreesCache = [];
    let userLocationMarker = null;
    let lastProximityAlertTime = 0;
    let isGpsActive = false;

    // --- DOM ELEMENT REFERENCES ---
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
    const customLightbox = document.getElementById('custom-lightbox');
    const lightboxImg = document.getElementById('lightbox-img');
    const lightboxClose = document.querySelector('.lightbox-close');
    const lightboxPrev = document.querySelector('.lightbox-nav.prev');
    const lightboxNext = document.querySelector('.lightbox-nav.next');
    const gpsButton = document.getElementById('gps-button');
    const landButton = document.getElementById('land-button');

    // --- LEAFLET MAP & ICONS ---
    const map = L.map(mapElement).setView(LAND_COORDINATES, 17);

    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        attribution: 'Tiles &copy; Esri',
        maxZoom: 22
    }).addTo(map);

    const icons = {
        red: createIcon('red'),
        green: createIcon('green'),
        blue: createIcon('blue'),
        grey: createIcon('grey')
    };
    function createIcon(color) {
        return new L.Icon({
            iconUrl: `https://raw.githack.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-${color}.png`,
            shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
            iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41]
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
            setTimeout(() => toastNotification.classList.add('hidden'), 3000);
        }, 3000);
    }

    // --- GPS & PROXIMITY ---
    function startGpsTracking() {
        if (!navigator.geolocation) {
            showToast("Tarayıcınız GPS özelliğini desteklemiyor.");
            return;
        }
        isGpsActive = true;
        showToast("Konumunuz bulunuyor...");
        navigator.geolocation.watchPosition(
            (position) => {
                const { latitude, longitude } = position.coords;
                const userLatLng = L.latLng(latitude, longitude);
                if (userLocationMarker) {
                    userLocationMarker.setLatLng(userLatLng);
                } else {
                    const userIcon = L.divIcon({ className: 'user-location-marker', html: '<div class="pulse"></div>', iconSize: [20, 20] });
                    userLocationMarker = L.marker(userLatLng, { icon: userIcon }).addTo(map);
                    showToast("Konumunuz bulundu!");
                }
                checkProximity(userLatLng);
            },
            () => { 
                showToast("Konum bilgisi alınamadı. İzinleri kontrol edin.");
                isGpsActive = false;
            },
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
        );
    }

    function checkProximity(userLatLng) {
        const now = Date.now();
        if (now - lastProximityAlertTime < 10000) return;
        let closestTree = null;
        let minDistance = Infinity;
        localTreesCache.forEach(tree => {
            if (tree.coords) {
                const treeLatLng = L.latLng(tree.coords.latitude, tree.coords.longitude);
                const distance = userLatLng.distanceTo(treeLatLng);
                if (distance < minDistance) {
                    minDistance = distance;
                    closestTree = tree;
                }
            }
        });
        if (closestTree && minDistance < 15) {
            showToast(`Yakınsınız: ${closestTree.title} (${minDistance.toFixed(0)}m)`);
            lastProximityAlertTime = now;
        }
    }

    // --- FIREBASE & UI RENDERING ---
    function listenForRealtimeUpdates() {
        showLoader();
        db.collection("trees").onSnapshot((snapshot) => {
            localTreesCache = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            renderMarkers(localTreesCache);
            renderSidebarList(localTreesCache);
            hideLoader();
        }, (error) => {
            console.error("Veri dinleme hatası: ", error);
            showToast("Hata: Veriler alınamadı!");
            hideLoader();
        });
    }

    function renderMarkers(trees) {
        map.eachLayer(layer => { if (layer instanceof L.Marker && layer !== userLocationMarker) map.removeLayer(layer); });
        trees.forEach(tree => {
            if (!tree.coords || tree.coords.latitude === undefined) return;
            const marker = L.marker([tree.coords.latitude, tree.coords.longitude], { icon: icons[tree.pinColor] || icons.grey }).addTo(map);
            marker.on('click', () => { openEditModal(tree.id); });
        });
    }

    function renderSidebarList(trees) {
        pinList.innerHTML = '';
        trees.forEach(tree => {
            const listItem = document.createElement('li');
            listItem.className = 'pin-list-item';
            listItem.dataset.id = tree.id;
            let coverImageSrc = "https://placehold.co/60x60/eeeeee/999999/png?text=Foto+Yok";
            if (tree.imageUrls && tree.imageUrls.length > 0) {
                coverImageSrc = tree.imageUrls[0];
            }
            listItem.innerHTML = `<img src="${coverImageSrc}" class="list-image-preview" alt="${tree.title}"><div class="list-item-content"><h3>${tree.title}</h3><p>${tree.description || "Açıklama yok."}</p></div>`;
            pinList.appendChild(listItem);
        });
    }

    function renderImagePreviews(imageUrls = []) {
        imagePreviewContainer.innerHTML = '';
        imageUrls.forEach((imgSrc) => {
            const wrapper = document.createElement('div');
            wrapper.className = 'img-preview-wrapper';
            const previewImg = document.createElement('img');
            previewImg.src = imgSrc;
            previewImg.className = 'img-preview';
            previewImg.onclick = () => openLightbox(imageUrls, imageUrls.indexOf(imgSrc));
            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'delete-img-btn';
            deleteBtn.innerHTML = '&times;';
            deleteBtn.dataset.src = imgSrc;
            wrapper.appendChild(previewImg);
            wrapper.appendChild(deleteBtn);
            imagePreviewContainer.appendChild(wrapper);
        });
    }

    // --- ÖZEL GALERİ FONKSİYONLARI ---
    let currentLightboxImages = []; 
    let currentLightboxIndex = 0;
    function openLightbox(images, startIndex) {
        currentLightboxImages = images;
        currentLightboxIndex = startIndex;
        updateLightboxImage();
        customLightbox.classList.remove('hidden');
    }
    function closeLightbox() {
        customLightbox.classList.add('hidden');
        currentLightboxImages = [];
    }
    function updateLightboxImage() {
        if(currentLightboxImages.length > 0) lightboxImg.src = currentLightboxImages[currentLightboxIndex];
    }
    function showNextImage() {
        currentLightboxIndex = (currentLightboxIndex + 1) % currentLightboxImages.length;
        updateLightboxImage();
    }
    function showPrevImage() {
        currentLightboxIndex = (currentLightboxIndex - 1 + currentLightboxImages.length) % currentLightboxImages.length;
        updateLightboxImage();
    }

    // --- MODAL & FORM LOGIC ---
    function openEditModal(id) {
        const tree = localTreesCache.find(t => t.id === id);
        if (!tree) return;
        currentPinInfo = { id: tree.id, coords: { lat: tree.coords.latitude, lng: tree.coords.longitude } };
        titleInput.value = tree.title;
        descriptionTextarea.value = tree.description;
        healthStatusSelect.value = tree.health;
        document.querySelectorAll('.color-dot').forEach(dot => dot.classList.remove('selected'));
        const currentDot = document.querySelector(`.color-dot[data-color="${tree.pinColor}"]`);
        if (currentDot) currentDot.classList.add('selected'); else document.querySelector('.color-dot[data-color="grey"]').classList.add('selected');
        renderImagePreviews(tree.imageUrls);
        deleteButton.style.display = 'block';
        modal.style.display = 'block';
    }

    function openCreateModal(coords) {
        currentPinInfo = { id: null, coords: { lat: coords.lat, lng: coords.lng } };
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
            let treeData = {};
            if (currentPinInfo.id) {
                treeData = localTreesCache.find(t => t.id === currentPinInfo.id) || {};
            }
            const selectedColor = document.querySelector('.color-dot.selected').dataset.color;
            const treeObject = {
                title: titleInput.value || "İsimsiz Ağaç",
                description: descriptionTextarea.value,
                health: healthStatusSelect.value,
                pinColor: selectedColor,
                coords: new firebase.firestore.GeoPoint(currentPinInfo.coords.lat, currentPinInfo.coords.lng),
                imageUrls: treeData.imageUrls || []
            };
            if (currentPinInfo.id) {
                await db.collection("trees").doc(currentPinInfo.id).set(treeObject, { merge: true });
            } else {
                await db.collection("trees").add(treeObject);
            }
            showToast("Başarıyla buluta kaydedildi!");
        } catch (error) { console.error("Kaydetme hatası:", error); showToast("Hata: Buluta kaydedilemedi!"); }
        finally { hideLoader(); closeModal(); }
    }

    async function handleDelete() {
        if (!currentPinInfo || !currentPinInfo.id) return;
        if (confirm("Bu ağacı buluttan kalıcı olarak silmek istediğinizden emin misiniz?")) {
            showLoader();
            try {
                const tree = localTreesCache.find(t => t.id === currentPinInfo.id);
                if (tree && tree.imageUrls && tree.imageUrls.length > 0) {
                    const deletePromises = tree.imageUrls.map(url => storage.refFromURL(url).delete().catch(err => console.warn("Resim silinemedi:", err)));
                    await Promise.all(deletePromises);
                }
                await db.collection("trees").doc(currentPinInfo.id).delete();
                showToast("Ağaç ve fotoğrafları silindi!");
            } catch (error) { console.error("Silme hatası:", error); showToast("Hata: Silinemedi!"); }
            finally { hideLoader(); closeModal(); }
        }
    }

    // --- IMAGE HANDLING ---
    async function handleImageUpload(files) {
        if (!currentPinInfo || !currentPinInfo.id) {
            alert("Lütfen önce ağaç bilgilerini 'Değişiklikleri Kaydet' diyerek kaydedin, sonra fotoğraf ekleyin."); return;
        }
        const treeRef = db.collection("trees").doc(currentPinInfo.id);
        const treeDoc = await treeRef.get();
        if (!treeDoc.exists) {
            alert("Ağaç henüz veritabanında oluşturulmadı. Lütfen önce kaydedin.");
            return;
        }
        const existingImageCount = treeDoc.data().imageUrls?.length || 0;
        if (existingImageCount + files.length > 10) { alert("En fazla 10 fotoğraf yükleyebilirsiniz."); return; }
        if (files.length === 0) return;
        
        showLoader();
        const uploadPromises = Array.from(files).map(file => {
            const fileName = `${Date.now()}-${file.name}`;
            const fileRef = storage.ref().child(`images/${currentPinInfo.id}/${fileName}`);
            return fileRef.put(file).then(() => fileRef.getDownloadURL());
        });

        try {
            const downloadUrls = await Promise.all(uploadPromises);
            await treeRef.update({ imageUrls: firebase.firestore.FieldValue.arrayUnion(...downloadUrls) });
            showToast(`${files.length} fotoğraf yüklendi ve kaydedildi.`);
        } catch (error) { console.error("Fotoğraf yükleme hatası:", error); showToast("Hata: Fotoğraflar yüklenemedi."); }
        finally { hideLoader(); }
    }

    async function handleDeleteImage(imageUrl) {
        if (!currentPinInfo || !currentPinInfo.id) return;
        if (!confirm("Bu fotoğrafı kalıcı olarak silmek istediğinizden emin misiniz?")) return;
        
        showLoader();
        try {
            const imageRef = storage.refFromURL(imageUrl);
            await imageRef.delete();
            const treeRef = db.collection("trees").doc(currentPinInfo.id);
            await treeRef.update({ imageUrls: firebase.firestore.FieldValue.arrayRemove(imageUrl) });
            showToast("Fotoğraf silindi.");
        } catch (error) { console.error("Fotoğraf silme hatası:", error); showToast("Hata: Fotoğraf silinemedi."); }
        finally { hideLoader(); }
    }

    // --- EVENT LISTENERS & INITIALIZATION ---
    closeButton.onclick = closeModal;
    saveButton.onclick = handleSave;
    deleteButton.onclick = handleDelete;
    map.on('click', e => openCreateModal(e.latlng));
    pinList.addEventListener('click', e => {
        const listItem = e.target.closest('.pin-list-item');
        if (listItem) {
            const id = listItem.dataset.id;
            const tree = localTreesCache.find(t => t.id === id);
            if (tree) {
                map.flyTo([tree.coords.latitude, tree.coords.longitude], 18);
                openEditModal(id);
                if (window.innerWidth <= 768) { sidebar.classList.remove('visible'); }
            }
        }
    });
    imagePreviewContainer.addEventListener('click', e => {
        if (e.target.classList.contains('delete-img-btn')) {
            const imageUrl = e.target.dataset.src;
            handleDeleteImage(imageUrl);
        }
    });
    document.getElementById('addFromGallery').onclick = () => galleryUpload.click();
    document.getElementById('addFromCamera').onclick = () => cameraUpload.click();
    galleryUpload.onchange = (e) => handleImageUpload(e.target.files);
    cameraUpload.onchange = (e) => handleImageUpload(e.target.files);
    pinColorSelector.addEventListener('click', e => { if (e.target.classList.contains('color-dot')) { document.querySelectorAll('.color-dot').forEach(dot => dot.classList.remove('selected')); e.target.classList.add('selected'); } });
    
    lightboxClose.onclick = closeLightbox;
    lightboxNext.onclick = showNextImage;
    lightboxPrev.onclick = showPrevImage;
    gpsButton.onclick = () => {
        if (userLocationMarker) {
            map.flyTo(userLocationMarker.getLatLng(), 19);
        } else {
            if (!isGpsActive) {
                startGpsTracking();
            } else {
                showToast("Konumunuz zaten bulunuyor...");
            }
        }
    };
    landButton.onclick = () => {
        showToast("Arazinize gidiliyor...");
        map.flyTo(LAND_COORDINATES, 18);
    };
    hamburgerMenu.onclick = () => { sidebar.classList.add('visible'); setTimeout(() => map.invalidateSize(), 300); };
    closeSidebar.onclick = () => { sidebar.classList.remove('visible'); setTimeout(() => map.invalidateSize(), 300); };
    window.addEventListener('resize', () => { setTimeout(() => map.invalidateSize(), 150); });

    listenForRealtimeUpdates();
});
