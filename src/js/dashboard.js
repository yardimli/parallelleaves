document.addEventListener('DOMContentLoaded', () => {
	const novelList = document.getElementById('novel-list');
	const loadingMessage = document.getElementById('loading-message');
	const importDocBtn = document.getElementById('import-doc-btn');
	
	// MODIFIED: Elements are for language settings now.
	const proseModal = document.getElementById('prose-settings-modal');
	const proseForm = document.getElementById('prose-settings-form');
	const proseNovelIdInput = document.getElementById('prose-novel-id');
	const saveProseBtn = document.getElementById('save-prose-settings-btn');
	const sourceLangSelect = document.getElementById('prose_source_language');
	const targetLangSelect = document.getElementById('prose_target_language');
	
	// Meta Modal Elements
	const metaModal = document.getElementById('meta-settings-modal');
	const metaForm = document.getElementById('meta-settings-form');
	const metaNovelIdInput = document.getElementById('meta-novel-id');
	const metaCoverPreview = document.getElementById('meta-cover-preview');
	const saveMetaBtn = document.getElementById('save-meta-settings-btn');
	const generateCoverBtn = document.getElementById('generate-cover-btn');
	const uploadCoverBtn = document.getElementById('upload-cover-btn');
	const deleteNovelBtn = document.getElementById('delete-novel-btn');
	
	let novelsData = [];
	let stagedCover = null;
	
	const languages = [
		"English", "Spanish", "French", "German", "Mandarin Chinese", "Hindi", "Arabic", "Bengali", "Russian", "Portuguese", "Indonesian", "Urdu", "Japanese", "Swahili", "Marathi", "Telugu", "Turkish", "Korean", "Tamil", "Vietnamese", "Italian", "Javanese", "Thai", "Gujarati", "Polish", "Ukrainian", "Malayalam", "Kannada", "Oriya", "Burmese", "Norwegian", "Finnish", "Danish", "Swedish", "Dutch", "Greek", "Czech", "Hungarian", "Romanian", "Bulgarian", "Serbian", "Croatian", "Slovak", "Slovenian", "Lithuanian", "Latvian", "Estonian", "Hebrew", "Persian", "Afrikaans", "Zulu", "Xhosa", "Amharic", "Yoruba", "Igbo", "Hausa", "Nepali", "Sinhala", "Khmer", "Lao", "Mongolian", "Pashto", "Tajik", "Uzbek", "Kurdish", "Albanian", "Macedonian", "Bosnian", "Icelandic", "Irish", "Welsh", "Catalan", "Basque", "Galician", "Luxembourgish", "Maltese"
	];
	
	// MODIFIED: This function now populates two select elements.
	function populateLanguages() {
		languages.forEach(lang => {
			sourceLangSelect.add(new Option(lang, lang));
			targetLangSelect.add(new Option(lang, lang));
		});
	}
	
	function setButtonLoading(button, isLoading) {
		const content = button.querySelector('.js-btn-content');
		const spinner = button.querySelector('.js-btn-spinner');
		button.disabled = isLoading;
		if (content) content.classList.toggle('hidden', isLoading);
		if (spinner) spinner.classList.toggle('hidden', !isLoading);
	}
	
	// MODIFIED: Opens the language settings modal and populates it.
	function openProseSettingsModal(novel) {
		proseNovelIdInput.value = novel.id;
		sourceLangSelect.value = novel.source_language || 'English';
		targetLangSelect.value = novel.target_language || 'English';
		proseModal.showModal();
	}
	
	function openMetaSettingsModal(novel) {
		stagedCover = null;
		metaNovelIdInput.value = novel.id;
		metaForm.querySelector('#meta-title').value = novel.title;
		metaForm.querySelector('#meta-author').value = novel.author || '';
		
		const currentNovel = novelsData.find(n => n.id === novel.id);
		if (currentNovel && currentNovel.cover_path) {
			metaCoverPreview.innerHTML = `<img src="file://${currentNovel.cover_path}?t=${Date.now()}" alt="Current cover" class="w-full h-auto">`;
		} else {
			metaCoverPreview.innerHTML = `<img src="./assets/book-placeholder.png" alt="No Cover" class="w-full h-auto">`;
		}
		
		metaModal.showModal();
	}
	
	function updateNovelCardUI(novelId) {
		const novel = novelsData.find(n => n.id === novelId);
		if (!novel) return;
		
		const card = novelList.querySelector(`[data-novel-id='${novelId}']`);
		if (card) {
			card.querySelector('.card-title').textContent = novel.title;
			card.querySelector('.text-base-content\\/80').textContent = novel.author || 'Unknown Author';
		}
	}
	
	async function loadInitialData() {
		try {
			novelsData = await window.api.getNovelsWithCovers();
			renderNovels();
		} catch (error) {
			console.error('Failed to load initial data:', error);
			loadingMessage.textContent = 'Error loading projects.';
		}
	}
	
	function renderNovels() {
		loadingMessage.style.display = 'none';
		
		if (novelsData.length === 0) {
			// MODIFIED: Updated text for translation context.
			novelList.innerHTML = '<p class="text-base-content/70 col-span-full text-center">You haven\'t started any translation projects yet.</p>';
			return;
		}
		
		novelList.innerHTML = '';
		novelsData.forEach(novel => {
			const novelCard = document.createElement('div');
			novelCard.className = 'card card-compact bg-base-200 shadow-xl transition-shadow';
			novelCard.dataset.novelId = novel.id;
			
			const coverHtml = novel.cover_path
				? `<img src="file://${novel.cover_path}" alt="Cover for ${novel.title}" class="w-full">`
				: `<img src="./assets/book-placeholder.png" alt="No Cover" class="w-full h-auto">`;
			
			
			novelCard.innerHTML = `
                <figure class="cursor-pointer js-open-editor">${coverHtml}</figure>
                <div class="card-body">
                    <h2 class="card-title">${novel.title}</h2>
                    <p class="text-base-content/80">${novel.author || 'Unknown Author'}</p>
                    <div class="card-actions justify-end items-center mt-2">
                        <button class="btn btn-ghost btn-sm js-meta-settings" title="Edit Meta">
                            <i class="bi bi-pencil-square text-lg"></i>
                        </button>
                        <!-- MODIFIED: Title changed for clarity -->
                        <button class="btn btn-ghost btn-sm js-prose-settings" title="Language Settings">
                            <i class="bi bi-translate text-lg"></i>
                        </button>
                        <div class="flex-grow"></div>
                        <button class="btn btn-secondary js-open-outline">Outline</button>
                        <!-- MODIFIED: Button text changed -->
                        <button class="btn btn-primary js-open-editor">Translate</button>
                    </div>
                </div>
            `;
			
			novelCard.querySelectorAll('.js-open-editor').forEach(el => el.addEventListener('click', () => window.api.openEditor(novel.id)));
			novelCard.querySelector('.js-prose-settings').addEventListener('click', () => openProseSettingsModal(novel));
			novelCard.querySelector('.js-meta-settings').addEventListener('click', () => openMetaSettingsModal(novel));
			novelCard.querySelector('.js-open-outline').addEventListener('click', () => window.api.openOutline(novel.id));
			
			novelList.appendChild(novelCard);
		});
	}
	
	// --- Event Listeners ---
	
	if (importDocBtn) {
		importDocBtn.addEventListener('click', () => {
			window.api.openImportWindow();
		});
	}
	
	// MODIFIED: Saves language settings instead of prose settings.
	saveProseBtn.addEventListener('click', async (e) => {
		e.preventDefault();
		const novelId = parseInt(proseNovelIdInput.value, 10);
		const formData = new FormData(proseForm);
		const data = {
			novelId,
			source_language: formData.get('prose_source_language'),
			target_language: formData.get('prose_target_language'),
		};
		
		try {
			await window.api.updateProseSettings(data);
			const novelIndex = novelsData.findIndex(n => n.id === novelId);
			if (novelIndex !== -1) Object.assign(novelsData[novelIndex], data);
			proseModal.close();
		} catch (error) {
			console.error('Failed to save language settings:', error);
		}
	});
	
	saveMetaBtn.addEventListener('click', async (e) => {
		e.preventDefault();
		const novelId = parseInt(metaNovelIdInput.value, 10);
		
		const formData = new FormData(metaForm);
		const data = {
			novelId,
			title: formData.get('title'),
			author: formData.get('author'),
		};
		
		try {
			await window.api.updateNovelMeta(data);
			const novelIndex = novelsData.findIndex(n => n.id === novelId);
			if (novelIndex !== -1) Object.assign(novelsData[novelIndex], data);
			updateNovelCardUI(novelId);
			
			if (stagedCover) {
				await window.api.updateNovelCover({ novelId, coverInfo: stagedCover });
			}
			
			metaModal.close();
		} catch (error) {
			console.error('Failed to save meta settings:', error);
			alert('Error saving settings: ' + error.message);
		}
	});
	
	generateCoverBtn.addEventListener('click', async () => {
		const novelId = parseInt(metaNovelIdInput.value, 10);
		genCoverPrompt.value = '';
		genCoverPreview.innerHTML = `<p class="text-base-content/50">Image preview will appear here</p>`;
		acceptGenCoverBtn.disabled = true;
		genCoverModal.showModal();
		
		setButtonLoading(generateCoverBtn, false);
	});
	
	uploadCoverBtn.addEventListener('click', async () => {
		const filePath = await window.api.showOpenImageDialog();
		if (filePath) {
			stagedCover = { type: 'local', data: filePath };
			metaCoverPreview.innerHTML = `<img src="file://${filePath}" alt="Staged cover" class="w-full h-auto">`;
		}
	});
	
	deleteNovelBtn.addEventListener('click', async () => {
		const novelId = parseInt(metaNovelIdInput.value, 10);
		const novel = novelsData.find(n => n.id === novelId);
		if (!novel) return;
		
		// MODIFIED: Updated confirmation text.
		const confirmation = confirm(`Are you sure you want to permanently delete "${novel.title}"?\n\nThis action cannot be undone.`);
		if (confirmation) {
			try {
				await window.api.deleteNovel(novelId);
				novelsData = novelsData.filter(n => n.id !== novelId);
				metaModal.close();
				renderNovels();
			} catch (error) {
				console.error('Failed to delete project:', error);
				alert('Error deleting project.');
			}
		}
	});
	
	// --- IPC Listeners ---
	
	window.api.onCoverUpdated((event, { novelId, imagePath }) => {
		const novelIndex = novelsData.findIndex(n => n.id === novelId);
		if (novelIndex !== -1) {
			novelsData[novelIndex].cover_path = imagePath;
		}
		
		const card = novelList.querySelector(`[data-novel-id='${novelId}']`);
		if (card) {
			const figure = card.querySelector('figure');
			if (figure) {
				figure.innerHTML = `<img src="file://${imagePath}?t=${Date.now()}" alt="Cover for project ${novelId}" class="w-full">`;
			}
		}
	});
	
	populateLanguages();
	loadInitialData();
});
