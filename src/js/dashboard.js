import { initI18n, t, applyTranslationsTo, setLanguage, supportedLanguages } from './i18n.js';

document.addEventListener('DOMContentLoaded', async () => {
	await initI18n(true);
	
	/**
	 * Displays a custom modal alert to prevent focus issues with native alerts.
	 * @param {string} message - The message to display.
	 * @param {string} [title='Error'] - The title for the alert modal.
	 */
	window.showAlert = function(message, title = t('common.error')) {
		const modal = document.getElementById('alert-modal');
		if (modal) {
			const modalTitle = modal.querySelector('#alert-modal-title');
			const modalContent = modal.querySelector('#alert-modal-content');
			if (modalTitle) modalTitle.textContent = title;
			if (modalContent) modalContent.textContent = message;
			modal.showModal();
		} else {
			// Fallback for pages without the modal
			alert(message);
		}
	};
	
	// --- DOM Elements ---
	const novelList = document.getElementById('novel-list');
	const loadingMessage = document.getElementById('loading-message');
	const importDocBtn = document.getElementById('import-doc-btn');
	const authContainer = document.getElementById('auth-container');
	const loginModal = document.getElementById('login-modal');
	const loginForm = document.getElementById('login-form');
	const loginErrorMsg = document.getElementById('login-error-message');
	const loginSubmitBtn = document.getElementById('login-submit-btn');
	const loginLangSelect = document.getElementById('login-language');
	
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
	
	// AI Cover Generation elements
	const metaCoverActions = document.getElementById('meta-cover-actions');
	const metaAiGenControls = document.getElementById('meta-ai-gen-controls');
	const metaAiPrompt = document.getElementById('meta-ai-prompt');
	const runGenerateCoverBtn = document.getElementById('run-generate-cover-btn');
	const cancelGenerateCoverBtn = document.getElementById('cancel-generate-cover-btn');
	const refreshBtn = document.getElementById('js-refresh-page-btn'); // Added refresh button
	
	let novelsData = [];
	let stagedCover = null;
	let isRefreshingData = false;
	
	const languages = [
		"English", "Spanish", "French", "German", "Mandarin Chinese", "Hindi", "Arabic", "Bengali", "Russian", "Portuguese", "Indonesian", "Urdu", "Japanese", "Swahili", "Marathi", "Telugu", "Turkish", "Korean", "Tamil", "Vietnamese", "Italian", "Javanese", "Thai", "Gujarati", "Polish", "Ukrainian", "Malayalam", "Kannada", "Oriya", "Burmese", "Norwegian", "Finnish", "Danish", "Swedish", "Dutch", "Greek", "Czech", "Hungarian", "Romanian", "Bulgarian", "Serbian", "Croatian", "Slovak", "Slovenian", "Lithuanian", "Latvian", "Estonian", "Hebrew", "Persian", "Afrikaans", "Zulu", "Xhosa", "Amharic", "Yoruba", "Igbo", "Hausa", "Nepali", "Sinhala", "Khmer", "Lao", "Mongolian", "Pashto", "Tajik", "Uzbek", "Kurdish", "Albanian", "Macedonian", "Bosnian", "Icelandic", "Irish", "Welsh", "Catalan", "Basque", "Galician", "Luxembourgish", "Maltese"
	];
	
	function populateLanguages() {
		languages.forEach(lang => {
			sourceLangSelect.add(new Option(lang, lang));
			targetLangSelect.add(new Option(lang, lang));
		});
	}
	
	// --- Authentication Logic ---
	
	function populateLoginLanguageSelect() {
		const currentLang = localStorage.getItem('app_lang') || 'en';
		loginLangSelect.innerHTML = '';
		for (const [code, name] of Object.entries(supportedLanguages)) {
			const option = new Option(name, code);
			if (code === currentLang) {
				option.selected = true;
			}
			loginLangSelect.add(option);
		}
	}
	
	function updateAuthUI(session) {
		if (session && session.user) {
			authContainer.innerHTML = `
                <span class="font-semibold">${t('dashboard.welcome', { username: session.user.username })}</span>
                <button id="logout-btn" class="btn btn-ghost btn-sm">${t('dashboard.signOut')}</button>
            `;
			document.getElementById('logout-btn').addEventListener('click', handleLogout);
			loadInitialData(); // Load projects only when logged in
			window.api.getModels().catch(err => {
				console.error('Failed to pre-fetch AI models on startup:', err);
			});
		} else {
			authContainer.innerHTML = `
                <button id="login-btn" class="btn btn-primary">${t('dashboard.signIn')}</button>
            `;
			document.getElementById('login-btn').addEventListener('click', () => loginModal.showModal());
			
			novelList.innerHTML = `<p class="text-base-content/70 col-span-full text-center">${t('dashboard.signInPrompt')}</p>`;
			loadingMessage.style.display = 'none';
			
			loginModal.showModal();
		}
	}
	
	async function handleLogin(event) {
		event.preventDefault();
		loginErrorMsg.classList.add('hidden');
		setButtonLoading(loginSubmitBtn, true);
		
		const username = loginForm.elements.username.value;
		const password = loginForm.elements.password.value;
		const lang = loginForm.elements.language.value;
		
		try {
			const result = await window.api.login({ username, password });
			if (result.success) {
				if (lang !== (localStorage.getItem('app_lang') || 'en')) {
					await setLanguage(lang);
				} else {
					loginModal.close();
					updateAuthUI(result.session);
				}
			} else {
				loginErrorMsg.textContent = t(result.message) || t('dashboard.login.failed');
				loginErrorMsg.classList.remove('hidden');
			}
		} catch (error) {
			loginErrorMsg.textContent = error.message;
			loginErrorMsg.classList.remove('hidden');
		} finally {
			setButtonLoading(loginSubmitBtn, false);
		}
	}
	
	async function handleLogout() {
		await window.api.logout();
		updateAuthUI(null);
	}
	
	async function initAuth() {
		const session = await window.api.getSession();
		updateAuthUI(session);
		populateLoginLanguageSelect();
		loginForm.addEventListener('submit', handleLogin);
		
		loginLangSelect.addEventListener('change', async (e) => {
			const newLang = e.target.value;
			await setLanguage(newLang);
		});
		
		document.getElementById('signup-link').addEventListener('click', (e) => {
			e.preventDefault();
			window.api.openExternalRegister();
		});
	}
	
	function setButtonLoading(button, isLoading) {
		const content = button.querySelector('.js-btn-content');
		const spinner = button.querySelector('.js-btn-spinner');
		button.disabled = isLoading;
		if (content) content.classList.toggle('hidden', isLoading);
		if (spinner) spinner.classList.toggle('hidden', !isLoading);
	}
	
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
			metaCoverPreview.innerHTML = `<img src="file://${currentNovel.cover_path}?t=${Date.now()}" alt="${t('dashboard.metaSettings.altCurrentCover')}" class="w-full h-auto">`;
		} else {
			metaCoverPreview.innerHTML = `<img src="./assets/bookcover-placeholder.jpg" alt="${t('dashboard.metaSettings.altNoCover')}" class="w-full h-auto">`;
		}
		
		metaAiGenControls.classList.add('hidden');
		metaCoverActions.classList.remove('hidden');
		
		metaModal.showModal();
	}
	
	function updateNovelCardUI(novelId) {
		const novel = novelsData.find(n => n.id === novelId);
		if (!novel) return;
		
		const card = novelList.querySelector(`[data-novel-id='${novelId}']`);
		if (card) {
			card.querySelector('.card-title').textContent = novel.title;
			card.querySelector('.text-base-content\\/80').textContent = novel.author || t('common.unknownAuthor');
		}
	}
	
	async function loadInitialData() {
		if (isRefreshingData) {
			return;
		}
		isRefreshingData = true;
		
		try {
			novelsData = await window.api.getNovelsWithCovers();
			renderNovels();
		} catch (error) {
			console.error('Failed to load initial data:', error);
			loadingMessage.textContent = t('dashboard.errorLoading');
		} finally {
			isRefreshingData = false;
		}
	}
	
	function renderNovels() {
		loadingMessage.style.display = 'none';
		
		if (novelsData.length === 0) {
			novelList.innerHTML = `<p class="text-base-content/70 col-span-full text-center" data-i18n="dashboard.noProjects">${t('dashboard.noProjects')}</p>`;
			return;
		}
		
		novelList.innerHTML = '';
		novelsData.forEach(novel => {
			const novelCard = document.createElement('div');
			novelCard.className = 'card card-compact bg-base-200 shadow-xl transition-shadow h-full flex flex-col';
			novelCard.dataset.novelId = novel.id;
			
			const coverHtml = novel.cover_path
				? `<img src="file://${novel.cover_path}?t=${new Date(novel.updated_at).getTime()}" alt="${t('dashboard.metaSettings.altCoverFor', { title: novel.title })}" class="w-full">`
				: `<img src="./assets/bookcover-placeholder.jpg" alt="${t('dashboard.metaSettings.altNoCover')}" class="w-full h-auto">`;
			
			
			novelCard.innerHTML = `
                <figure class="cursor-pointer js-open-outline">${coverHtml}</figure>
                <div class="card-body flex flex-col flex-grow">
                    <h2 class="card-title js-open-editor cursor-pointer">${novel.title}</h2>
                    <p class="text-base-content/80 -mt-2 mb-2">${novel.author || t('common.unknownAuthor')}</p>
                    
                    <!-- Stats Section -->
                    <div class="text-xs space-y-2 text-base-content/70 mt-auto">
                        <!-- Progress Bar -->
                        <div>
                            <div class="flex justify-between mb-1">
                                <span class="font-semibold" data-i18n="dashboard.card.progress">Progress</span>
                                <span class="js-progress-percent">0%</span>
                            </div>
                            <progress class="progress progress-primary w-full js-progress-bar" value="0" max="100"></progress>
                        </div>
                        
                        <!-- Word Counts -->
                        <div class="grid grid-cols-2 gap-x-4">
                            <div>
                                <div class="font-semibold" data-i18n="dashboard.card.sourceWords">Source</div>
                                <div class="js-source-words">0 words</div>
                            </div>
                            <div>
                                <div class="font-semibold" data-i18n="dashboard.card.targetWords">Target</div>
                                <div class="js-target-words">0 words</div>
                            </div>
                        </div>

                        <!-- Chapter Counts -->
                        <div class="grid grid-cols-2 gap-x-4">
                            <div>
                                <div class="font-semibold" data-i18n="dashboard.card.chapters">Chapters</div>
                                <div class="js-chapter-count">0</div>
                            </div>
                        </div>

                        <!-- Dates -->
                        <div class="border-t border-base-content/10 pt-2 mt-2 text-base-content/50">
                             <div class="flex justify-between">
                                <span data-i18n="dashboard.card.created">Created:</span>
                                <span class="js-created-date"></span>
                             </div>
                             <div class="flex justify-between">
                                <span data-i18n="dashboard.card.updated">Updated:</span>
                                <span class="js-updated-date"></span>
                             </div>
                        </div>
                    </div>
                    
                    <div class="card-actions justify-end items-center mt-4">
                        <button class="btn btn-ghost btn-sm js-meta-settings" data-i18n-title="common.edit">
                            <i class="bi bi-pencil-square text-lg"></i>
                        </button>
                        <button class="btn btn-ghost btn-sm js-prose-settings" data-i18n-title="dashboard.proseSettings.title">
                            <i class="bi bi-translate text-lg"></i>
                        </button>
                    </div>
                </div>
            `;
			
			const progressBar = novelCard.querySelector('.js-progress-bar');
			const progressPercent = novelCard.querySelector('.js-progress-percent');
			const sourceWords = novelCard.querySelector('.js-source-words');
			const targetWords = novelCard.querySelector('.js-target-words');
			const chapterCountEl = novelCard.querySelector('.js-chapter-count');
			const createdDateEl = novelCard.querySelector('.js-created-date');
			const updatedDateEl = novelCard.querySelector('.js-updated-date');
			
			let progress = 0;
			if (novel.source_word_count > 0) {
				progress = Math.round((novel.target_word_count / novel.source_word_count) * 100);
			} else if (novel.target_word_count > 0) {
				progress = 100;
			}
			progress = Math.min(100, Math.max(0, progress));
			
			if (progressBar) progressBar.value = progress;
			if (progressPercent) progressPercent.textContent = `${progress}%`;
			
			const numberFormat = new Intl.NumberFormat();
			const wordLabel = t('common.words');
			
			if (sourceWords) sourceWords.textContent = `${numberFormat.format(novel.source_word_count)} ${wordLabel}`;
			if (targetWords) targetWords.textContent = `${numberFormat.format(novel.target_word_count)} ${wordLabel}`;
			if (chapterCountEl) chapterCountEl.textContent = novel.chapter_count;
			
			const dateFormatOptions = { year: 'numeric', month: 'short', day: 'numeric' };
			if (createdDateEl && novel.created_at) {
				createdDateEl.textContent = new Date(novel.created_at).toLocaleDateString(undefined, dateFormatOptions);
			}
			if (updatedDateEl && novel.updated_at) {
				updatedDateEl.textContent = new Date(novel.updated_at).toLocaleDateString(undefined, dateFormatOptions);
			}
			
			novelCard.querySelectorAll('.js-open-editor').forEach(el => el.addEventListener('click', () => window.api.openEditor(novel.id)));
			novelCard.querySelector('.js-prose-settings').addEventListener('click', () => openProseSettingsModal(novel));
			novelCard.querySelector('.js-meta-settings').addEventListener('click', () => openMetaSettingsModal(novel));
			novelCard.querySelector('.js-open-outline').addEventListener('click', () => window.api.openOutline(novel.id));
			
			novelList.appendChild(novelCard);
		});
		
		applyTranslationsTo(novelList);
	}
	
	// --- Event Listeners ---
	
	// Added: Refresh button listener
	if (refreshBtn) {
		refreshBtn.addEventListener('click', () => {
			window.location.reload();
		});
	}
	
	if (importDocBtn) {
		importDocBtn.addEventListener('click', () => {
			window.api.openImportWindow();
		});
	}
	
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
			window.showAlert('Error saving settings: ' + error.message);
		}
	});
	
	generateCoverBtn.addEventListener('click', async () => {
		metaCoverActions.classList.add('hidden');
		metaAiGenControls.classList.remove('hidden');
		metaAiPrompt.value = '';
		metaAiPrompt.disabled = true;
		
		const novelTitle = metaForm.querySelector('#meta-title').value;
		try {
			const result = await window.api.generateCoverPrompt({ novelTitle });
			if (result.success && result.prompt) {
				metaAiPrompt.value = result.prompt;
			} else {
				metaAiPrompt.value = `A book cover for a story titled "${novelTitle}"`;
			}
		} catch (error) {
			console.error('Failed to generate cover prompt:', error);
			metaAiPrompt.value = `A book cover for a story titled "${novelTitle}"`;
		} finally {
			metaAiPrompt.disabled = false;
		}
	});
	
	cancelGenerateCoverBtn.addEventListener('click', () => {
		metaAiGenControls.classList.add('hidden');
		metaCoverActions.classList.remove('hidden');
	});
	
	runGenerateCoverBtn.addEventListener('click', async () => {
		const novelId = parseInt(metaNovelIdInput.value, 10);
		const prompt = metaAiPrompt.value.trim();
		if (!prompt) {
			showAlert('Please enter an image prompt.');
			return;
		}
		
		setButtonLoading(runGenerateCoverBtn, true);
		metaCoverPreview.innerHTML = `<div class="flex flex-col items-center justify-center h-full gap-2">
			<span class="loading loading-spinner loading-lg"></span>
			<p class="text-sm text-base-content/60">Generating image...</p>
		</div>`;
		
		try {
			const result = await window.api.generateCover({ novelId, prompt });
			if (result.success && result.filePath) {
				stagedCover = { type: 'local', data: result.filePath };
				metaCoverPreview.innerHTML = `<img src="file://${result.filePath}?t=${Date.now()}" alt="${t('dashboard.metaSettings.altStagedCover')}" class="w-full h-auto">`;
			} else {
				throw new Error(result.message || 'Failed to generate cover.');
			}
		} catch (error) {
			console.error('Failed to generate cover:', error);
			window.showAlert('Error generating cover: ' + error.message);
			const currentNovel = novelsData.find(n => n.id === novelId);
			if (currentNovel && currentNovel.cover_path) {
				metaCoverPreview.innerHTML = `<img src="file://${currentNovel.cover_path}?t=${Date.now()}" alt="${t('dashboard.metaSettings.altCurrentCover')}" class="w-full h-auto">`;
			} else {
				metaCoverPreview.innerHTML = `<img src="./assets/bookcover-placeholder.jpg" alt="${t('dashboard.metaSettings.altNoCover')}" class="w-full h-auto">`;
			}
		} finally {
			setButtonLoading(runGenerateCoverBtn, false);
		}
	});
	
	uploadCoverBtn.addEventListener('click', async () => {
		const filePath = await window.api.showOpenImageDialog();
		if (filePath) {
			stagedCover = { type: 'local', data: filePath };
			metaCoverPreview.innerHTML = `<img src="file://${filePath}" alt="${t('dashboard.metaSettings.altStagedCover')}" class="w-full h-auto">`;
		}
	});
	
	deleteNovelBtn.addEventListener('click', async () => {
		const novelId = parseInt(metaNovelIdInput.value, 10);
		const novel = novelsData.find(n => n.id === novelId);
		if (!novel) return;
		
		const confirmation = confirm(t('dashboard.metaSettings.deleteConfirm', { title: novel.title }));
		if (confirmation) {
			try {
				await window.api.deleteNovel(novelId);
				novelsData = novelsData.filter(n => n.id !== novelId);
				metaModal.close();
				renderNovels();
			} catch (error) {
				console.error('Failed to delete project:', error);
				window.showAlert(t('dashboard.metaSettings.errorDelete'));
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
				const novel = novelsData.find(n => n.id === novelId);
				const altText = t('dashboard.metaSettings.altCoverFor', { title: novel ? novel.title : novelId });
				figure.innerHTML = `<img src="file://${imagePath}?t=${Date.now()}" alt="${altText}" class="w-full">`;
			}
		}
	});
	
	// --- Initializations ---
	populateLanguages();
	initAuth();
	
	window.addEventListener('focus', () => {
		// Only refresh if the user is logged in (auth container has a logout button).
		if (document.getElementById('logout-btn')) {
			loadInitialData();
		}
	});
});
