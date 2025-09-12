const {contextBridge, ipcRenderer} = require('electron');

contextBridge.exposeInMainWorld('api', {
	// --- App Level ---
	openImportWindow: () => ipcRenderer.send('app:open-import-window'), // NEW
	
	// --- Dashboard/Novel Creation ---
	getNovelsWithCovers: () => ipcRenderer.invoke('novels:getAllWithCovers'),
	getOneNovel: (novelId) => ipcRenderer.invoke('novels:getOne', novelId),
	getFullManuscript: (novelId) => ipcRenderer.invoke('novels:getFullManuscript', novelId),
	createNovel: (data) => ipcRenderer.invoke('novels:store', data),
	openEditor: (novelId) => ipcRenderer.send('novels:openEditor', novelId),
	openOutline: (novelId) => ipcRenderer.send('novels:openOutline', novelId),
	getOutlineData: (novelId) => ipcRenderer.invoke('novels:getOutlineData', novelId),
	updateProseSettings: (data) => ipcRenderer.invoke('novels:updateProseSettings', data),
	
	updateNovelMeta: (data) => ipcRenderer.invoke('novels:updateMeta', data),
	updateNovelCover: (data) => ipcRenderer.invoke('novels:updateCover', data),
	deleteNovel: (novelId) => ipcRenderer.invoke('novels:delete', novelId),
	
	getStructureFiles: () => ipcRenderer.invoke('files:getStructureFiles'),
	generateStructure: (data) => ipcRenderer.invoke('novels:generateStructure', data),
	
	onCoverUpdated: (callback) => ipcRenderer.on('novels:cover-updated', callback),
	
	// --- Document Import ---
	showOpenDocumentDialog: () => ipcRenderer.invoke('dialog:showOpenDocument'), // NEW
	readDocumentContent: (filePath) => ipcRenderer.invoke('document:read', filePath), // NEW
	importDocumentAsNovel: (data) => ipcRenderer.invoke('document:import', data), // NEW
	
	// --- Editor Specific APIs ---
	
	getTemplate: (templateName) => ipcRenderer.invoke('templates:get', templateName),
	
	// State Management
	saveEditorState: (novelId, state) => ipcRenderer.invoke('editor:saveState', novelId, state),
	
	// Window Content Fetching
	getChapterHtml: (chapterId) => ipcRenderer.invoke('chapters:getOneHtml', chapterId),
	getCodexEntryHtml: (entryId) => ipcRenderer.invoke('codex-entries:getOneHtml', entryId),
	
	// Chapter <-> Codex Linking
	attachCodexToChapter: (chapterId, codexEntryId) => ipcRenderer.invoke('chapters:codex:attach', chapterId, codexEntryId),
	detachCodexFromChapter: (chapterId, codexEntryId) => ipcRenderer.invoke('chapters:codex:detach', chapterId, codexEntryId),
	
	openChapterEditor: (data) => ipcRenderer.send('chapters:openEditor', data),
	onManuscriptScrollToChapter: (callback) => ipcRenderer.on('manuscript:scrollToChapter', callback),
	
	updateChapterFull: (chapterId, data) => ipcRenderer.invoke('chapters:updateFull', chapterId, data),
	updateChapterField: (data) => ipcRenderer.invoke('chapters:updateField', data),
	
	updateChapterContent: (chapterId, data) => ipcRenderer.invoke('chapters:updateContent', chapterId, data),
	createChapter: (novelId, data) => ipcRenderer.invoke('chapters:store', novelId, data),
	
	// Chapter POV APIs
	getPovDataForChapter: (chapterId) => ipcRenderer.invoke('chapters:getPovData', chapterId),
	updateChapterPov: (data) => ipcRenderer.invoke('chapters:updatePov', data),
	deleteChapterPovOverride: (chapterId) => ipcRenderer.invoke('chapters:deletePovOverride', chapterId),
	getLinkedCodexIdsForChapter: (chapterId) => ipcRenderer.invoke('chapters:getLinkedCodexIds', chapterId),
	
	// Codex Entry Management
	openNewCodexEditor: (data) => ipcRenderer.send('codex-entries:openNewEditor', data),
	openCodexEditor: (entryId) => ipcRenderer.send('codex-entries:openEditor', entryId),
	getOneCodexForEditor: (entryId) => ipcRenderer.invoke('codex-entries:getOneForEditor', entryId),
	createCodexEntry: (novelId, formData) => ipcRenderer.invoke('codex-entries:store', novelId, formData),
	suggestCodexDetails: (novelId, text) => ipcRenderer.invoke('codex-entries:suggest-details', { novelId, text }),
	updateCodexEntry: (entryId, data) => ipcRenderer.invoke('codex-entries:update', entryId, data),
	getAllCodexEntriesForNovel: (novelId) => ipcRenderer.invoke('codex:getAllForNovel', novelId),
	getCategoriesForNovel: (novelId) => ipcRenderer.invoke('codex-categories:getAllForNovel', novelId),
	
	// Codex <-> Codex Linking
	attachCodexToCodex: (parentEntryId, linkedEntryId) => ipcRenderer.invoke('codex-entries:link:attach', parentEntryId, linkedEntryId),
	detachCodexFromCodex: (parentEntryId, linkedEntryId) => ipcRenderer.invoke('codex-entries:link:detach', parentEntryId, linkedEntryId),
	
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
});
