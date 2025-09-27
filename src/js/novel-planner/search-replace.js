import { t } from '../i18n.js';

let chapterEditorViews;
let globalMatches = [];
let currentMatchIndex = -1;
let searchResponsesPending = 0;
let resultHandlerCallback;

// UI Elements
let searchReplaceBar, searchInput, replaceInput, prevBtn, nextBtn, replaceBtn, replaceAllBtn, resultsCount, closeBtn, caseSensitiveBtn;

const debounce = (func, delay) => {
	let timeout;
	return function (...args) {
		const context = this;
		clearTimeout(timeout);
		timeout = setTimeout(() => func.apply(context, args), delay);
	};
};

function initializeUI() {
	searchReplaceBar = document.getElementById('js-search-replace-bar');
	searchInput = document.getElementById('js-search-replace-input');
	replaceInput = document.getElementById('js-replace-input');
	prevBtn = document.getElementById('js-search-replace-prev-btn');
	nextBtn = document.getElementById('js-search-replace-next-btn');
	replaceBtn = document.getElementById('js-replace-btn');
	replaceAllBtn = document.getElementById('js-replace-all-btn');
	resultsCount = document.getElementById('js-search-replace-results-count');
	closeBtn = document.getElementById('js-search-replace-close-btn');
	caseSensitiveBtn = document.getElementById('js-case-sensitive-btn');
}

function toggleSearchReplaceBar(show) {
	if (show) {
		document.getElementById('js-search-bar').classList.add('hidden'); // Hide other search bar
		searchReplaceBar.classList.remove('hidden');
		searchInput.focus();
		searchInput.select();
	} else {
		searchReplaceBar.classList.add('hidden');
		clearSearch();
	}
}

function openSearchAndReplaceWithValues(findValue, replaceValue) {
	toggleSearchReplaceBar(true);
	searchInput.value = findValue || '';
	replaceInput.value = replaceValue || '';
	startSearch();
}

function clearSearch() {
	chapterEditorViews.forEach(view => {
		if (view.isReady) {
			view.contentWindow.postMessage({ type: 'search-replace:clear' }, window.location.origin);
		}
	});
	globalMatches = [];
	currentMatchIndex = -1;
	resultsCount.textContent = '';
	prevBtn.disabled = true;
	nextBtn.disabled = true;
	replaceBtn.disabled = true;
	replaceAllBtn.disabled = true;
}

function updateResultsUI() {
	const total = globalMatches.length;
	resultsCount.textContent = total > 0
		? t('editor.searchReplace.results', { current: currentMatchIndex + 1, total })
		: t('editor.searchReplace.noResults');
	
	const hasMatches = total > 0;
	prevBtn.disabled = !hasMatches;
	nextBtn.disabled = !hasMatches;
	replaceBtn.disabled = !hasMatches;
	replaceAllBtn.disabled = !hasMatches;
}

function navigateToMatch(index) {
	if (index < 0 || index >= globalMatches.length) return;
	
	if (currentMatchIndex !== -1) {
		const oldMatch = globalMatches[currentMatchIndex];
		const oldView = chapterEditorViews.get(oldMatch.chapterId.toString());
		if (oldView?.isReady) {
			oldView.contentWindow.postMessage({ type: 'search-replace:navigateTo', payload: { matchIndex: oldMatch.matchIndex, isActive: false } }, window.location.origin);
		}
	}
	
	currentMatchIndex = index;
	const newMatch = globalMatches[currentMatchIndex];
	const newView = chapterEditorViews.get(newMatch.chapterId.toString());
	if (newView?.isReady) {
		newView.contentWindow.postMessage({ type: 'search-replace:navigateTo', payload: { matchIndex: newMatch.matchIndex, isActive: true } }, window.location.origin);
	}
	
	updateResultsUI();
}

const startSearch = debounce(() => {
	const query = searchInput.value;
	clearSearch();
	if (query.length < 1) {
		updateResultsUI();
		return;
	}
	
	const caseSensitive = caseSensitiveBtn.classList.contains('active');
	searchResponsesPending = 0;
	
	chapterEditorViews.forEach(view => {
		if (view.isReady) {
			searchResponsesPending++;
			view.contentWindow.postMessage({ type: 'search-replace:find', payload: { query, caseSensitive } }, window.location.origin);
		}
	});
}, 300);

function handleReplace() {
	if (currentMatchIndex === -1) return;
	
	const match = globalMatches[currentMatchIndex];
	const view = chapterEditorViews.get(match.chapterId.toString());
	if (view?.isReady) {
		view.contentWindow.postMessage({
			type: 'search-replace:replace',
			payload: {
				matchIndex: match.matchIndex,
				replaceText: replaceInput.value
			}
		}, window.location.origin);
	}
}

function handleReplaceAll() {
	const query = searchInput.value;
	if (query.length < 1) return;
	
	const replaceText = replaceInput.value;
	const caseSensitive = caseSensitiveBtn.classList.contains('active');
	
	searchResponsesPending = 0;
	let totalReplaced = 0;
	
	chapterEditorViews.forEach(view => {
		if (view.isReady) {
			searchResponsesPending++;
			view.contentWindow.postMessage({ type: 'search-replace:replaceAll', payload: { query, replaceText, caseSensitive } }, window.location.origin);
		}
	});
	
	const handler = (type, payload) => {
		if (type === 'search-replace:replacedAll') {
			totalReplaced += payload.count;
			searchResponsesPending--;
			if (searchResponsesPending === 0) {
				clearSearch();
				resultsCount.textContent = t('editor.searchReplace.replaceAllResult', { count: totalReplaced });
				resultHandlerCallback = null;
			}
		}
	};
	
	resultHandlerCallback = handler;
}

function handleIframeResponse(type, payload) {
	switch (type) {
		case 'search-replace:results': {
			const { chapterId, matchCount } = payload;
			for (let i = 0; i < matchCount; i++) {
				globalMatches.push({ chapterId, matchIndex: i });
			}
			
			searchResponsesPending--;
			if (searchResponsesPending === 0) {
				const chapterOrder = Array.from(document.querySelectorAll('.manuscript-chapter-item[data-chapter-id]')).map(el => el.dataset.chapterId);
				globalMatches.sort((a, b) => {
					const orderA = chapterOrder.indexOf(a.chapterId.toString());
					const orderB = chapterOrder.indexOf(b.chapterId.toString());
					if (orderA !== orderB) return orderA - orderB;
					return a.matchIndex - b.matchIndex;
				});
				
				if (globalMatches.length > 0) {
					navigateToMatch(0);
				} else {
					updateResultsUI();
				}
			}
			break;
		}
		case 'search-replace:replaced': {
			startSearch();
			break;
		}
		case 'search-replace:replacedAll': {
			if (resultHandlerCallback) {
				resultHandlerCallback(type, payload);
			}
			break;
		}
	}
}

export function setupSearchAndReplace(views, registerHandler) {
	chapterEditorViews = views;
	registerHandler((type, payload) => handleIframeResponse(type, payload));
	
	initializeUI();
	
	const searchReplaceBtn = document.getElementById('js-search-replace-btn');
	searchReplaceBtn.addEventListener('click', () => toggleSearchReplaceBar(true));
	closeBtn.addEventListener('click', () => toggleSearchReplaceBar(false));
	
	searchInput.addEventListener('input', startSearch);
	
	caseSensitiveBtn.addEventListener('click', () => {
		caseSensitiveBtn.classList.toggle('active');
		startSearch();
	});
	
	nextBtn.addEventListener('click', () => navigateToMatch((currentMatchIndex + 1) % globalMatches.length));
	prevBtn.addEventListener('click', () => navigateToMatch((currentMatchIndex - 1 + globalMatches.length) % globalMatches.length));
	
	replaceBtn.addEventListener('click', handleReplace);
	replaceAllBtn.addEventListener('click', handleReplaceAll);
	
	// The global keydown listener has been moved to chapter-main.js for centralized handling.
	
	searchInput.addEventListener('keydown', (e) => {
		if (e.key === 'Enter') {
			e.preventDefault();
			if (e.shiftKey) {
				if (!prevBtn.disabled) prevBtn.click();
			} else {
				if (!nextBtn.disabled) nextBtn.click();
			}
		}
		
		if (e.key === 'Escape' && !searchReplaceBar.classList.contains('hidden')) {
			toggleSearchReplaceBar(false);
		}
	});
	
	replaceInput.addEventListener('keydown', (e) => {
		if (e.key === 'Enter') {
			e.preventDefault();
			if (!replaceBtn.disabled) {
				handleReplace();
			}
		}
	});
	
	return {
		openWithValues: openSearchAndReplaceWithValues,
		toggle: toggleSearchReplaceBar,
		isHidden: () => searchReplaceBar.classList.contains('hidden')
	};
}
