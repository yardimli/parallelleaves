const {contextBridge, ipcRenderer} = require('electron');

contextBridge.exposeInMainWorld('api', {
	// --- App Level ---
	openImportWindow: () => ipcRenderer.send('app:open-import-window'),
	openChatWindow: (novelId) => ipcRenderer.send('app:openChatWindow', novelId),
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
	getAllNovelContent: (novelId) => ipcRenderer.invoke('novels:getAllContent', novelId),
	
	getNovelForExport: (novelId) => ipcRenderer.invoke('novels:getForExport', novelId),
	exportNovelToDocx: (data) => ipcRenderer.invoke('novels:exportToDocx', data),
	
	openEditor: (novelId) => ipcRenderer.send('novels:openEditor', novelId),
	openOutline: (novelId) => ipcRenderer.send('novels:openOutline', novelId),
	openOutlineAndAutogenCodex: (novelId) => ipcRenderer.send('novels:openOutlineAndAutogenCodex', novelId),
	getOutlineData: (novelId) => ipcRenderer.invoke('novels:getOutlineData', novelId),
	getOutlineState: (novelId) => ipcRenderer.invoke('novels:getOutlineState', novelId),
	startCodexAutogen: (data) => ipcRenderer.send('autogen:start-codex-generation', data),
	onCodexAutogenUpdate: (callback) => ipcRenderer.on('autogen:progress-update', callback),
	onCodexAutogenTrigger: (callback) => ipcRenderer.on('outline:trigger-autogen', callback),
	updateProseSettings: (data) => ipcRenderer.invoke('novels:updateProseSettings', data),
	updatePromptSettings: (data) => ipcRenderer.invoke('novels:updatePromptSettings', data),
	
	updateNovelMeta: (data) => ipcRenderer.invoke('novels:updateMeta', data),
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
	
	// Codex Entry Management
	openNewCodexEditor: (data) => ipcRenderer.send('codex-entries:openNewEditor', data),
	openCodexEditor: (entryId) => ipcRenderer.send('codex-entries:openEditor', entryId),
	getOneCodexForEditor: (entryId) => ipcRenderer.invoke('codex-entries:getOneForEditor', entryId),
	createCodexEntry: (novelId, formData) => ipcRenderer.invoke('codex-entries:store', novelId, formData),
	suggestCodexDetails: (novelId, text) => ipcRenderer.invoke('codex-entries:suggest-details', { novelId, text }),
	updateCodexEntry: (entryId, data) => ipcRenderer.invoke('codex-entries:update', entryId, data),
	deleteCodexEntry: (entryId) => ipcRenderer.invoke('codex-entries:delete', entryId),
	getAllCodexEntriesForNovel: (novelId) => ipcRenderer.invoke('codex:getAllForNovel', novelId),
	getCategoriesForNovel: (novelId) => ipcRenderer.invoke('codex-categories:getAllForNovel', novelId),
	
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
	saveNovelDictionary: (novelId, data) => ipcRenderer.invoke('dictionary:save', novelId, data),
	
	findHighestMarkerNumber: (sourceHtml, targetHtml) => ipcRenderer.invoke('novels:findHighestMarkerNumber', sourceHtml, targetHtml)
});
