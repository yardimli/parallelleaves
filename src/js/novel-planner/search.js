import { t } from '../i18n.js';

let globalSearchMatches = [];
let currentMatchIndex = -1;
let searchResponsesPending = 0;

/**
 * Encapsulates all search-related functionality.
 * @param {Map} chapterEditorViews - The map of chapter editor views.
 * @param {function} registerSearchResultHandler - A function to register a callback for search results from iframes.
 * @returns {{toggle: function(boolean): void, isHidden: function(): boolean}} An API to control the search bar.
 */
export function setupSearch (chapterEditorViews, registerSearchResultHandler) {
	const searchBtn = document.getElementById('js-search-btn');
	const searchBar = document.getElementById('js-search-bar');
	const searchInput = document.getElementById('js-search-input');
	const searchCloseBtn = document.getElementById('js-search-close-btn');
	const searchPrevBtn = document.getElementById('js-search-prev-btn');
	const searchNextBtn = document.getElementById('js-search-next-btn');
	const searchResultsCount = document.getElementById('js-search-results-count');
	const searchScopeRadios = document.querySelectorAll('input[name="search-scope"]');
	
	const toggleSearchBar = (show) => {
		if (show) {
			// Modified: Ensure search & replace bar is hidden when this one opens.
			document.getElementById('js-search-replace-bar').classList.add('hidden');
			searchBar.classList.remove('hidden');
			searchInput.focus();
			searchInput.select();
		} else {
			searchBar.classList.add('hidden');
			clearSearch();
		}
	};
	
	const clearHighlightsInSource = () => {
		const sourceContainer = document.getElementById('js-source-column-container');
		const marks = sourceContainer.querySelectorAll('mark.search-highlight');
		marks.forEach(mark => {
			const parent = mark.parentNode;
			parent.replaceChild(document.createTextNode(mark.textContent), mark);
			parent.normalize();
		});
	};
	
	const clearSearch = () => {
		clearHighlightsInSource();
		chapterEditorViews.forEach(view => {
			if (view.isReady) {
				view.contentWindow.postMessage({ type: 'search:clear' }, window.location.origin);
			}
		});
		globalSearchMatches = [];
		currentMatchIndex = -1;
		searchResultsCount.textContent = '';
		searchPrevBtn.disabled = true;
		searchNextBtn.disabled = true;
	};
	
	const findAndHighlightInSource = (query) => {
		clearHighlightsInSource();
		if (!query) return [];
		
		const sourceContainer = document.getElementById('js-source-column-container');
		const matches = [];
		const walker = document.createTreeWalker(sourceContainer, NodeFilter.SHOW_TEXT, null, false);
		const nodesToProcess = [];
		let node;
		while ((node = walker.nextNode())) {
			if (node.parentElement.closest('script, style')) continue;
			if (new RegExp(query, 'gi').test(node.textContent)) {
				nodesToProcess.push(node);
			}
		}
		
		nodesToProcess.forEach(textNode => {
			const text = textNode.textContent;
			const fragment = document.createDocumentFragment();
			let lastIndex = 0;
			const regex = new RegExp(query, 'gi');
			let match;
			
			while ((match = regex.exec(text)) !== null) {
				if (match.index > lastIndex) {
					fragment.appendChild(document.createTextNode(text.substring(lastIndex, match.index)));
				}
				const mark = document.createElement('mark');
				mark.className = 'search-highlight';
				mark.textContent = match[0];
				fragment.appendChild(mark);
				matches.push(mark);
				lastIndex = regex.lastIndex;
			}
			
			if (lastIndex < text.length) {
				fragment.appendChild(document.createTextNode(text.substring(lastIndex)));
			}
			
			if (textNode.parentNode) {
				textNode.parentNode.replaceChild(fragment, textNode);
			}
		});
		
		return matches;
	};
	
	const updateSearchResultsUI = () => {
		const total = globalSearchMatches.length;
		searchResultsCount.textContent = total > 0
			? t('editor.searchBar.results', { current: currentMatchIndex + 1, total })
			: t('editor.searchBar.noResults');
		searchPrevBtn.disabled = total <= 1;
		searchNextBtn.disabled = total <= 1;
	};
	
	const navigateToMatch = (index) => {
		if (index < 0 || index >= globalSearchMatches.length) return;
		
		if (currentMatchIndex !== -1) {
			const oldMatch = globalSearchMatches[currentMatchIndex];
			if (oldMatch.scope === 'source') {
				oldMatch.element.classList.remove('search-highlight-active');
			} else {
				const view = chapterEditorViews.get(oldMatch.chapterId.toString());
				if (view?.isReady) {
					view.contentWindow.postMessage({ type: 'search:navigateTo', payload: { matchIndex: oldMatch.matchIndex, isActive: false } }, window.location.origin);
				}
			}
		}
		
		currentMatchIndex = index;
		const newMatch = globalSearchMatches[currentMatchIndex];
		
		if (newMatch.scope === 'source') {
			newMatch.element.classList.add('search-highlight-active');
			newMatch.element.scrollIntoView({ behavior: 'smooth', block: 'center' });
		} else {
			const view = chapterEditorViews.get(newMatch.chapterId.toString());
			if (view?.isReady) {
				view.contentWindow.postMessage({ type: 'search:navigateTo', payload: { matchIndex: newMatch.matchIndex, isActive: true } }, window.location.origin);
			}
		}
		
		updateSearchResultsUI();
	};
	
	const debounce = (func, delay) => {
		let timeout;
		return function (...args) {
			const context = this;
			clearTimeout(timeout);
			timeout = setTimeout(() => func.apply(context, args), delay);
		};
	};
	
	const startSearch = debounce(() => {
		const query = searchInput.value;
		const scope = document.querySelector('input[name="search-scope"]:checked').value;
		
		clearSearch();
		if (query.length < 2) return;
		
		if (scope === 'source') {
			const matches = findAndHighlightInSource(query);
			globalSearchMatches = matches.map(el => ({ scope: 'source', element: el }));
			if (globalSearchMatches.length > 0) navigateToMatch(0);
			updateSearchResultsUI();
		} else {
			searchResponsesPending = chapterEditorViews.size;
			globalSearchMatches = [];
			chapterEditorViews.forEach(view => {
				if (view.isReady) {
					view.contentWindow.postMessage({ type: 'search:findAndHighlight', payload: { query } }, window.location.origin);
				} else {
					searchResponsesPending--;
				}
			});
		}
	}, 300);
	
	searchBtn.addEventListener('click', () => toggleSearchBar(true));
	searchCloseBtn.addEventListener('click', () => toggleSearchBar(false));
	searchInput.addEventListener('input', startSearch);
	searchScopeRadios.forEach(radio => radio.addEventListener('change', startSearch));
	
	searchNextBtn.addEventListener('click', () => navigateToMatch((currentMatchIndex + 1) % globalSearchMatches.length));
	searchPrevBtn.addEventListener('click', () => navigateToMatch((currentMatchIndex - 1 + globalSearchMatches.length) % globalSearchMatches.length));
	
	searchInput.addEventListener('keydown', (e) => {
		if (e.key === 'Enter') {
			e.preventDefault();
			if (e.shiftKey) {
				if (!searchPrevBtn.disabled) searchPrevBtn.click();
			} else {
				if (!searchNextBtn.disabled) searchNextBtn.click();
			}
		}
	});
	
	// Removed: The global keydown listener for Ctrl+F and Escape has been moved to chapter-main.js
	// for centralized shortcut management.
	
	registerSearchResultHandler((payload) => {
		const { chapterId, matchCount } = payload;
		for (let i = 0; i < matchCount; i++) {
			globalSearchMatches.push({ scope: 'target', chapterId, matchIndex: i });
		}
		
		searchResponsesPending--;
		if (searchResponsesPending === 0) {
			const chapterOrder = Array.from(document.querySelectorAll('.manuscript-chapter-item[data-chapter-id]')).map(el => el.dataset.chapterId);
			globalSearchMatches.sort((a, b) => {
				const orderA = chapterOrder.indexOf(a.chapterId.toString());
				const orderB = chapterOrder.indexOf(b.chapterId.toString());
				if (orderA !== orderB) return orderA - orderB;
				return a.matchIndex - b.matchIndex;
			});
			
			if (globalSearchMatches.length > 0) navigateToMatch(0);
			updateSearchResultsUI();
		}
	});
	
	// New: Return an API for external control (e.g., from global shortcut handler).
	return {
		toggle: toggleSearchBar,
		isHidden: () => searchBar.classList.contains('hidden')
	};
}
