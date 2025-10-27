const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
	// --- App Level ---
	openImportWindow: () => ipcRenderer.send('app:open-import-window'),
	openChatWindow: (novelId) => ipcRenderer.send('app:openChatWindow', novelId),
	openLearningWindow: (novelId) => ipcRenderer.send('app:openLearningWindow', novelId),
	startLearning: (data) => ipcRenderer.invoke('learning:start', data),
	onLearningUpdate: (callback) => ipcRenderer.on('learning:update', (event, ...args) => callback(...args)),
	// MODIFICATION START: Add new learning instruction handlers
	saveLearningInstructions: (data) => ipcRenderer.invoke('learning:saveInstructions', data),
	loadLearningInstructions: (novelId) => ipcRenderer.invoke('learning:loadInstructions', novelId),
	getLearningInstructionsForAI: (novelId) => ipcRenderer.invoke('learning:getInstructionsForAI', novelId),
	// MODIFICATION END
	getLangFile: (lang) => ipcRenderer.invoke('i18n:get-lang-file', lang),
	login: (credentials) => ipcRenderer.invoke('auth:login', credentials),
	logout: () => ipcRenderer.invoke('auth:logout'),
	getSession: () => ipcRenderer.invoke('auth:get-session'),
	openExternalRegister: () => ipcRenderer.send('auth:open-register-url'),
	
	splashGetInitData: () => ipcRenderer.invoke('splash:get-init-data'),
	splashCheckForUpdates: () => ipcRenderer.invoke('splash:check-for-updates'),
	splashClose: () => ipcRenderer.send('splash:close'),
	splashFinished: () => ipcRenderer.send('splash:finished'),
	openExternalUrl: (url) => ipcRenderer.send('app:open-external-url', url),
	
	// --- Dashboard/Novel Creation ---
	getNovelsWithCovers: () => ipcRenderer.invoke('novels:getAllWithCovers'),
	getOneNovel: (novelId) => ipcRenderer.invoke('novels:getOne', novelId),
	getFullManuscript: (novelId) => ipcRenderer.invoke('novels:getFullManuscript', novelId),
	getAllNovelContent: (novelId) => ipcRenderer.invoke('novels:getAllNovelContent', novelId),
	
	getNovelForExport: (novelId) => ipcRenderer.invoke('novels:getForExport', novelId),
	exportNovelToDocx: (data) => ipcRenderer.invoke('novels:exportToDocx', data),
	
	openEditor: (novelId) => ipcRenderer.send('novels:openEditor', novelId),
	openCodex: (novelId) => ipcRenderer.send('novels:openCodex', novelId),
	startCodexAutogen: (data) => ipcRenderer.send('autogen:start-codex-generation', data),
	stopCodexAutogen: () => ipcRenderer.send('autogen:stop-codex-generation'),
	onCodexAutogenUpdate: (callback) => ipcRenderer.on('autogen:progress-update', callback),
	onCodexAutogenFinished: (callback) => ipcRenderer.on('autogen:process-finished', callback),
	codex: {
		get: (novelId) => ipcRenderer.invoke('codex:get', novelId),
		save: (data) => ipcRenderer.invoke('codex:save', data),
	},
	updateProseSettings: (data) => ipcRenderer.invoke('novels:updateProseSettings', data),
	updatePromptSettings: (data) => ipcRenderer.invoke('novels:updatePromptSettings', data),
	
	updateNovelMeta: (data) => ipcRenderer.invoke('novels:updateMeta', data),
	createBlankNovel: (data) => ipcRenderer.invoke('novels:createBlank', data),
	updateNovelCover: (data) => ipcRenderer.invoke('novels:updateNovelCover', data),
	deleteNovel: (novelId) => ipcRenderer.invoke('novels:delete', novelId),
	
	onCoverUpdated: (callback) => ipcRenderer.on('novels:cover-updated', callback),
	
	// --- Document Import ---
	showOpenDocumentDialog: () => ipcRenderer.invoke('dialog:showOpenDocument'),
	readDocumentContent: (filePath) => ipcRenderer.invoke('document:read', filePath),
	importDocumentAsNovel: (data) => ipcRenderer.invoke('document:import', data),
	onImportStatusUpdate: (callback) => ipcRenderer.on('import:status-update', (event, ...args) => callback(...args)),
	
	// --- Editor Specific APIs ---
	getTemplate: (templateName) => ipcRenderer.invoke('templates:get', templateName),
	getRawChapterContent: (data) => ipcRenderer.invoke('chapters:getRawContent', data),
	getTranslationContext: (data) => ipcRenderer.invoke('chapters:getTranslationContext', data),
	
	openChapterEditor: (data) => ipcRenderer.send('chapters:openEditor', data),
	onManuscriptScrollToChapter: (callback) => ipcRenderer.on('manuscript:scrollToChapter', callback),
	
	updateChapterField: (data) => ipcRenderer.invoke('chapters:updateField', data),
	renameChapter: (data) => ipcRenderer.invoke('chapters:rename', data),
	deleteChapter: (data) => ipcRenderer.invoke('chapters:delete', data),
	insertChapter: (data) => ipcRenderer.invoke('chapters:insert', data),
	
	renameSection: (data) => ipcRenderer.invoke('sections:rename', data),
	deleteSection: (data) => ipcRenderer.invoke('sections:delete', data),
	insertSection: (data) => ipcRenderer.invoke('sections:insert', data),
	
	// LLM
	processLLMText: (data) => ipcRenderer.invoke('llm:process-text', data),
	chatSendMessage: (data) => ipcRenderer.invoke('chat:send-message', data),
	getModels: () => ipcRenderer.invoke('ai:getModels'),
	generateCoverPrompt: (data) => ipcRenderer.invoke('ai:generate-cover-prompt', data),
	generateCover: (data) => ipcRenderer.invoke('ai:generate-cover', data),
	
	// Spellchecker APIs
	getAvailableSpellCheckerLanguages: () => ipcRenderer.invoke('session:getAvailableSpellCheckerLanguages'),
	getCurrentSpellCheckerLanguage: () => ipcRenderer.invoke('session:getCurrentSpellCheckerLanguage'),
	setSpellCheckerLanguage: (lang) => ipcRenderer.invoke('session:setSpellCheckerLanguage', lang),
	
	getSupportedLanguages: () => ipcRenderer.invoke('languages:get-supported'),
	
	getNovelForBackup: (novelId) => ipcRenderer.invoke('novels:getForBackup', novelId),
	restoreNovelFromBackup: (backupData) => ipcRenderer.invoke('novels:restoreFromBackup', backupData),
	saveBackupToFile: (defaultFileName, jsonString) => ipcRenderer.invoke('dialog:saveBackup', defaultFileName, jsonString),
	openBackupFile: () => ipcRenderer.invoke('dialog:openBackup'),
	
	getNovelDictionary: (novelId) => ipcRenderer.invoke('dictionary:get', novelId),
	getDictionaryContentForAI: (novelId, type) => ipcRenderer.invoke('dictionary:getContentForAI', novelId, type),
	saveNovelDictionary: (novelId, data) => ipcRenderer.invoke('dictionary:save', novelId, data),
	
	// API for logging translation events
	logTranslationEvent: (data) => ipcRenderer.invoke('log:translation', data),
	
	findHighestMarkerNumber: (sourceHtml, targetHtml) => ipcRenderer.invoke('novels:findHighestMarkerNumber', sourceHtml, targetHtml)
});
