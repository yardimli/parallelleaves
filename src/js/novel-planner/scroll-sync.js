let isScrollingProgrammatically = false;

/**
 * Synchronizes the scroll position of a chapter between the source and target columns.
 * @param {string} chapterId - The ID of the chapter to sync.
 * @param {string} direction - 'source-to-target' or 'target-to-source'.
 */
export function syncChapterScroll (chapterId, direction) {
	const sourceChapterEl = document.getElementById(`source-chapter-scroll-target-${chapterId}`);
	const targetChapterEl = document.getElementById(`target-chapter-scroll-target-${chapterId}`);
	const sourceContainer = document.getElementById('js-source-column-container');
	const targetContainer = document.getElementById('js-target-column-container');
	
	if (!sourceChapterEl || !targetChapterEl || !sourceContainer || !targetContainer) {
		console.warn(`Could not find elements for chapter scroll sync: ${chapterId}`);
		return;
	}
	
	let sourceEl, targetEl, sourceWrapper, targetWrapper;
	
	if (direction === 'source-to-target') {
		sourceEl = sourceContainer;
		targetEl = targetContainer;
		sourceWrapper = sourceChapterEl;
		targetWrapper = targetChapterEl;
	} else {
		sourceEl = targetContainer;
		targetEl = sourceContainer;
		sourceWrapper = targetChapterEl;
		targetWrapper = sourceChapterEl;
	}
	
	const sourceContainerRect = sourceEl.getBoundingClientRect();
	const sourceWrapperRect = sourceWrapper.getBoundingClientRect();
	const relativeTop = sourceWrapperRect.top - sourceContainerRect.top;
	
	const targetContainerRect = targetEl.getBoundingClientRect();
	const targetWrapperRect = targetWrapper.getBoundingClientRect();
	const targetAbsoluteTop = targetWrapperRect.top;
	
	const desiredScrollTop = targetEl.scrollTop + (targetAbsoluteTop - targetContainerRect.top) - relativeTop;
	
	targetEl.scrollTo({
		top: desiredScrollTop,
		behavior: 'smooth'
	});
}

/**
 * Scrolls both manuscript columns to a specific chapter.
 * @param {string} chapterId - The ID of the chapter to scroll to.
 * @param {function} setActiveChapterIdCallback - Callback to update the active chapter ID state.
 */
export function scrollToChapter (chapterId, setActiveChapterIdCallback) {
	const sourceTarget = document.getElementById(`source-chapter-scroll-target-${chapterId}`);
	const targetTarget = document.getElementById(`target-chapter-scroll-target-${chapterId}`);
	const sourceContainer = document.getElementById('js-source-column-container');
	const targetContainer = document.getElementById('js-target-column-container');
	
	isScrollingProgrammatically = true;
	
	const scrollToTarget = (container, target) => {
		if (target && container) {
			const containerRect = container.getBoundingClientRect();
			const targetRect = target.getBoundingClientRect();
			const offsetTop = targetRect.top - containerRect.top;
			const scrollPosition = container.scrollTop + offsetTop - 100; // 100px offset from top
			
			container.scrollTo({
				top: scrollPosition,
				behavior: 'smooth'
			});
		}
	};
	
	scrollToTarget(sourceContainer, sourceTarget);
	scrollToTarget(targetContainer, targetTarget);
	
	setActiveChapterIdCallback(chapterId);
	
	setTimeout(() => {
		isScrollingProgrammatically = false;
	}, 1000); // Allow time for smooth scroll to complete
}

/**
 * Finds and scrolls to a specific translation marker in the target editor.
 * @param {string} chapterId - The ID of the chapter containing the marker.
 * @param {string} markerId - The numerical ID of the marker to find.
 * @param {string} markerType - The type of marker clicked ('opening' or 'closing').
 * @param {Map} chapterEditorViews - The map of chapter editor views.
 */
export function scrollToTargetMarker (chapterId, markerId, markerType, chapterEditorViews) {
	const viewInfo = chapterEditorViews.get(chapterId.toString());
	if (!viewInfo || !viewInfo.isReady) {
		console.warn(`Iframe for chapter ${chapterId} is not ready or not found.`);
		return;
	}
	
	// Corrected: Determine the SAME marker text to search for.
	const searchText = markerType === 'opening' ? `[[#${markerId}]]` : `{{#${markerId}}}`;
	
	viewInfo.contentWindow.postMessage({
		type: 'findAndScrollToText',
		payload: { text: searchText }
	}, window.location.origin);
}

/**
 * Finds and scrolls to a specific translation marker in the source column.
 * @param {string} markerId - The numerical ID of the marker to find.
 * @param {string} markerType - The type of marker clicked in the target editor.
 */
export function scrollToSourceMarker (markerId, markerType) {
	const sourceContainer = document.getElementById('js-source-column-container');
	if (!sourceContainer) return;
	
	// Corrected: Search for the SAME marker type in the source pane.
	const selector = `.translation-marker-link[data-marker-id="${markerId}"][data-marker-type="${markerType}"]`;
	const markerLink = sourceContainer.querySelector(selector);
	
	if (markerLink) {
		markerLink.scrollIntoView({ behavior: 'smooth', block: 'center' });
		markerLink.classList.add('search-highlight-active');
		setTimeout(() => {
			markerLink.classList.remove('search-highlight-active');
		}, 2000);
	} else {
		console.warn(`Source marker with ID ${markerId} and type ${markerType} not found.`);
	}
}

/**
 * Sets up the intersection observer to track the active chapter in the source column.
 * @param {function} setActiveChapterIdCallback - Callback to update the active chapter ID state.
 */
export function setupIntersectionObserver (setActiveChapterIdCallback) {
	const container = document.getElementById('js-source-column-container');
	const navDropdown = document.getElementById('js-chapter-nav-dropdown');
	
	const observer = new IntersectionObserver((entries) => {
		if (isScrollingProgrammatically) return;
		
		entries.forEach(entry => {
			if (entry.isIntersecting) {
				const chapterId = entry.target.dataset.chapterId;
				setActiveChapterIdCallback(chapterId, (newActiveId) => {
					navDropdown.value = newActiveId;
				});
			}
		});
	}, {
		root: container,
		rootMargin: '-40% 0px -60% 0px',
		threshold: 0
	});
	
	container.querySelectorAll('.manuscript-chapter-item').forEach(el => observer.observe(el));
}
