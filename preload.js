const {contextBridge, ipcRenderer} = require('electron');

contextBridge.exposeInMainWorld('api', {
	// --- App Level ---
	openImportWindow: () => ipcRenderer.send('app:open-import-window'),
	
	// --- Dashboard/Novel Creation ---
	getNovelsWithCovers: () => ipcRenderer.invoke('novels:getAllWithCovers'),
	getOneNovel: (novelId) => ipcRenderer.invoke('novels:getOne', novelId),
	getFullManuscript: (novelId) => ipcRenderer.invoke('novels:getFullManuscript', novelId),
	
	openEditor: (novelId) => ipcRenderer.send('novels:openEditor', novelId),
	openOutline: (novelId) => ipcRenderer.send('novels:openOutline', novelId),
	getOutlineData: (novelId) => ipcRenderer.invoke('novels:getOutlineData', novelId),
	getOutlineState: (novelId) => ipcRenderer.invoke('novels:getOutlineState', novelId),
	startCodexAutogen: (data) => ipcRenderer.send('autogen:start-codex-generation', data),
	onCodexAutogenUpdate: (callback) => ipcRenderer.on('autogen:progress-update', callback),
	updateProseSettings: (data) => ipcRenderer.invoke('novels:updateProseSettings', data),
	updatePromptSettings: (data) => ipcRenderer.invoke('novels:updatePromptSettings', data),
	
	updateNovelMeta: (data) => ipcRenderer.invoke('novels:updateMeta', data),
	updateNovelCover: (data) => ipcRenderer.invoke('novels:updateCover', data),
	deleteNovel: (novelId) => ipcRenderer.invoke('novels:delete', novelId),
	
	onCoverUpdated: (callback) => ipcRenderer.on('novels:cover-updated', callback),
	
	// --- Document Import ---
	showOpenDocumentDialog: () => ipcRenderer.invoke('dialog:showOpenDocument'),
	readDocumentContent: (filePath) => ipcRenderer.invoke('document:read', filePath),
	importDocumentAsNovel: (data) => ipcRenderer.invoke('document:import', data),
	
	// --- Editor Specific APIs ---
	
	getTemplate: (templateName) => ipcRenderer.invoke('templates:get', templateName),
	
	getTranslationContext: (data) => ipcRenderer.invoke('chapters:getTranslationContext', data),
	
	openChapterEditor: (data) => ipcRenderer.send('chapters:openEditor', data),
	onManuscriptScrollToChapter: (callback) => ipcRenderer.on('manuscript:scrollToChapter', callback),
	
	updateChapterField: (data) => ipcRenderer.invoke('chapters:updateField', data),
	
	createChapter: (novelId, data) => ipcRenderer.invoke('chapters:store', novelId, data),
	
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
	
	// Codex AI & Image Actions
	processCodexTextStream: (data, onData) => {
		const channel = `ai-text-chunk-${Date.now()}-${Math.random()}`;
		
		const listener = (event, payload) => {
			onData(payload);
			if (payload.done || payload.error) {
				ipcRenderer.removeListener(channel, listener);
			}
		};
		
		ipcRenderer.on(channel, listener);
		ipcRenderer.send('codex-entries:process-text-stream', {data, channel});
		
		return () => {
			ipcRenderer.removeListener(channel, listener);
		};
	},
	getModels: () => ipcRenderer.invoke('ai:getModels'),
	
	// Spellchecker APIs
	getAvailableSpellCheckerLanguages: () => ipcRenderer.invoke('session:getAvailableSpellCheckerLanguages'),
	getCurrentSpellCheckerLanguage: () => ipcRenderer.invoke('session:getCurrentSpellCheckerLanguage'),
	setSpellCheckerLanguage: (lang) => ipcRenderer.invoke('session:setSpellCheckerLanguage', lang),
});
