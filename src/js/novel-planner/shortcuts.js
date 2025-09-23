/**
 * Sets up global keyboard shortcuts for the chapter editor window.
 * @param {object} dependencies - An object containing necessary components and state accessors.
 * @param {object} dependencies.searchAPI - The API for the search bar.
 * @param {object} dependencies.searchReplaceAPI - The API for the search and replace bar.
 * @param {function} dependencies.getActiveEditor - Function to get the active editor window.
 * @param {function} dependencies.getLastFocusedSourceEditor - Function to get the last focused source editor element.
 * @param {Map} dependencies.chapterEditorViews - Map of all chapter editor views.
 */
export function setupShortcuts(dependencies) {
	const {
		searchAPI,
		searchReplaceAPI,
		getActiveEditor,
		getLastFocusedSourceEditor,
		chapterEditorViews
	} = dependencies;
	
	window.addEventListener('keydown', (e) => {
		const activeEl = document.activeElement;
		const isModalOpen = document.querySelector('.modal[open], .modal-open');
		
		if (isModalOpen) {
			return; // Ignore all shortcuts when a modal is active.
		}
		
		if (e.key === 'Escape') {
			const isSearchVisible = !searchAPI.isHidden();
			const isSearchReplaceVisible = !searchReplaceAPI.isHidden();
			
			if (isSearchVisible) {
				searchAPI.toggle(false);
				e.preventDefault();
			}
			if (isSearchReplaceVisible) {
				searchReplaceAPI.toggle(false);
				e.preventDefault();
			}
			// Prevent further action if a bar was closed.
			if (isSearchVisible || isSearchReplaceVisible) {
				return;
			}
		}
		
		if (e.ctrlKey || e.metaKey) {
			const isGenericInputFocused = activeEl &&
				(activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA') &&
				!activeEl.closest('#js-search-bar') &&
				!activeEl.closest('#js-search-replace-bar');
			
			// Prevent shortcuts from firing in regular input fields.
			if (isGenericInputFocused && ['f', 'h', 't'].includes(e.key.toLowerCase())) {
				return;
			}
			
			switch (e.key.toLowerCase()) {
				case 'f':
					e.preventDefault();
					// Only open search if search & replace is hidden.
					if (searchReplaceAPI.isHidden()) {
						searchAPI.toggle(true);
					}
					break;
				case 'h':
					e.preventDefault();
					searchReplaceAPI.toggle(true);
					break;
				case '1': {
					e.preventDefault();
					const lastFocused = getLastFocusedSourceEditor();
					if (lastFocused) {
						lastFocused.focus();
					} else {
						// Fallback to the first available source editor
						const sourceContainer = document.getElementById('js-source-column-container');
						const firstEditor = sourceContainer?.querySelector('.source-content-readonly');
						if (firstEditor) {
							firstEditor.focus();
						} else if (sourceContainer) {
							sourceContainer.focus({ preventScroll: true });
						}
					}
					break;
				}
				case '2': {
					e.preventDefault();
					const editorToFocus = getActiveEditor();
					if (editorToFocus) {
						editorToFocus.postMessage({ type: 'focusEditor' }, window.location.origin);
					} else {
						// Fallback: try to focus the editor for the currently active chapter
						const navDropdown = document.getElementById('js-chapter-nav-dropdown');
						const activeChapterId = navDropdown ? navDropdown.value : null;
						if (activeChapterId) {
							const viewInfo = chapterEditorViews.get(activeChapterId.toString());
							if (viewInfo && viewInfo.isReady) {
								viewInfo.contentWindow.postMessage({ type: 'focusEditor' }, window.location.origin);
							}
						}
					}
					break;
				}
				case 't': {
					const activeTargetEditor = getActiveEditor();
					if (activeTargetEditor) {
						e.preventDefault();
						activeTargetEditor.postMessage({ type: 'triggerTranslate' }, window.location.origin);
					}
					break;
				}
			}
		}
	});
}
