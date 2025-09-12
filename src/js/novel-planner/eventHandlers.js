/**
 * This module contains functions to set up various event listeners for the novel editor UI.
 */
import { getActiveEditor } from './content-editor.js';

/**
 * Sets up the event listener for opening codex entry windows.
 * It uses double-click for the main codex list and single-click for linked tags elsewhere.
 * @param {HTMLElement} desktop - The main desktop element to attach the listener to.
 * @param {WindowManager} windowManager - The window manager instance.
 */
export function setupCodexEntryHandler(desktop, windowManager) {
	const entryIcon = `<i class="bi bi-journal-richtext text-lg"></i>`;
	
	/**
	 * Helper function to open or focus a codex entry window.
	 * @param {string} entryId
	 * @param {string} entryTitle
	 */
	async function openCodexEntry(entryId, entryTitle) {
		const windowId = `codex-entry-${entryId}`;
		
		if (windowManager.windows.has(windowId)) {
			const win = windowManager.windows.get(windowId);
			if (win.isMinimized) {
				windowManager.restore(windowId);
			} else {
				windowManager.focus(windowId);
			}
			windowManager.scrollIntoView(windowId);
			return;
		}
		
		try {
			const content = await window.api.getCodexEntryHtml(entryId);
			if (!content) {
				throw new Error('Failed to load codex entry details.');
			}
			
			// Calculate position relative to the main codex window for better layout.
			let offsetX = 850;
			let offsetY = 120;
			const codexWin = windowManager.windows.get('codex-window');
			const openCodexWindows = Array.from(windowManager.windows.keys()).filter(k => k.startsWith('codex-entry-')).length;
			
			if (codexWin && !codexWin.isMinimized) {
				const codexEl = codexWin.element;
				offsetX = codexEl.offsetLeft + codexEl.offsetWidth + 20;
				offsetY = codexEl.offsetTop + (openCodexWindows * 30);
			} else {
				// Fallback to original logic if codex window isn't available
				offsetX += (openCodexWindows * 30);
				offsetY += (openCodexWindows * 30);
			}
			
			windowManager.createWindow({
				id: windowId,
				title: entryTitle,
				content: content,
				x: offsetX,
				y: offsetY,
				width: 600,
				height: 450,
				icon: entryIcon,
				closable: true
			});
			
			setTimeout(() => windowManager.scrollIntoView(windowId), 150);
		} catch (error) {
			console.error('Error opening codex entry window:', error);
			alert(error.message);
		}
	}
	
	desktop.addEventListener('click', (event) => {
		const entryButton = event.target.closest('.js-open-codex-entry');
		// This should NOT trigger for items in the main codex list.
		if (!entryButton || entryButton.closest('#codex-window')) {
			return;
		}
		
		const entryId = entryButton.dataset.entryId;
		const entryTitle = entryButton.dataset.entryTitle;
		openCodexEntry(entryId, entryTitle);
	});
	
	desktop.addEventListener('click', (event) => {
		const entryButton = event.target.closest('.js-open-codex-entry');
		// This should ONLY trigger for items in the main codex list.
		if (!entryButton || !entryButton.closest('#codex-window')) {
			return;
		}
		
		const entryId = entryButton.dataset.entryId;
		const entryTitle = entryButton.dataset.entryTitle;
		openCodexEntry(entryId, entryTitle);
	});
}

/**
 * Sets up the event listener for opening chapter windows.
 * This now uses a double-click event.
 * @param {HTMLElement} desktop - The main desktop element to attach the listener to.
 * @param {WindowManager} windowManager - The window manager instance.
 */
export function setupChapterHandler(desktop, windowManager) {
	const chapterIcon = `<i class="bi bi-card-text text-lg"></i>`;
	
	desktop.addEventListener('click', async (event) => {
		const chapterButton = event.target.closest('.js-open-chapter');
		if (!chapterButton) return;
		
		const chapterId = chapterButton.dataset.chapterId;
		const chapterTitle = chapterButton.dataset.chapterTitle;
		const windowId = `chapter-${chapterId}`;
		
		if (windowManager.windows.has(windowId)) {
			const win = windowManager.windows.get(windowId);
			if (win.isMinimized) {
				windowManager.restore(windowId);
			} else {
				windowManager.focus(windowId);
			}
			windowManager.scrollIntoView(windowId);
			return;
		}
		
		try {
			const content = await window.api.getChapterHtml(chapterId);
			if (!content) {
				throw new Error('Failed to load chapter details.');
			}
			
			// Calculate position relative to the outline window for better layout.
			let offsetX = 100;
			let offsetY = 300;
			const outlineWin = windowManager.windows.get('outline-window');
			const openChapterWindows = Array.from(windowManager.windows.keys()).filter(k => k.startsWith('chapter-')).length;
			
			if (outlineWin && !outlineWin.isMinimized) {
				const outlineEl = outlineWin.element;
				offsetX = outlineEl.offsetLeft + outlineEl.offsetWidth + 20;
				offsetY = outlineEl.offsetTop + (openChapterWindows * 30);
			} else {
				// Fallback to original logic if outline window isn't available
				offsetX += (openChapterWindows * 30);
				offsetY += (openChapterWindows * 30);
			}
			
			windowManager.createWindow({
				id: windowId,
				title: chapterTitle,
				content: content,
				x: offsetX,
				y: offsetY,
				width: 700,
				height: 500,
				icon: chapterIcon,
				closable: true
			});
			
			setTimeout(() => windowManager.scrollIntoView(windowId), 150);
		} catch (error) {
			console.error('Error opening chapter window:', error);
			alert(error.message);
		}
	});
}


/**
 * Sets up the "Open Windows" menu functionality in the taskbar.
 * @param {WindowManager} windowManager - The window manager instance.
 */
export function setupOpenWindowsMenu(windowManager) {
	const openWindowsBtn = document.getElementById('open-windows-btn');
	const openWindowsMenu = document.getElementById('open-windows-menu');
	const openWindowsList = document.getElementById('open-windows-list');
	
	function populateOpenWindowsMenu() {
		openWindowsList.innerHTML = '';
		
		if (windowManager.windows.size === 0) {
			openWindowsList.innerHTML = `<li><span class="px-4 py-2 text-sm text-base-content/70">No open windows.</span></li>`;
			return;
		}
		
		const createMenuItem = (innerHTML, onClick) => {
			const li = document.createElement('li');
			const button = document.createElement('button');
			button.className = 'w-full text-left px-4 py-2 text-sm hover:bg-base-200 flex items-center gap-3';
			button.innerHTML = innerHTML;
			button.addEventListener('click', () => {
				if (onClick) onClick();
				if (document.activeElement) document.activeElement.blur(); // Close dropdown
			});
			li.appendChild(button);
			return li;
		};
		
		const specialOrder = ['outline-window', 'codex-window'];
		const sortedWindows = [];
		const otherWindows = [];
		
		windowManager.windows.forEach((win, windowId) => {
			if (!specialOrder.includes(windowId)) {
				otherWindows.push({ win, windowId });
			}
		});
		
		specialOrder.forEach(id => {
			if (windowManager.windows.has(id)) {
				sortedWindows.push({ win: windowManager.windows.get(id), windowId: id });
			}
		});
		
		otherWindows.sort((a, b) => a.win.title.localeCompare(b.win.title));
		
		const allSortedWindows = [...sortedWindows, ...otherWindows];
		
		allSortedWindows.forEach(({ win, windowId }) => {
			const innerHTML = `<div class="w-5 h-5 flex-shrink-0">${win.icon || ''}</div><span class="truncate">${win.title}</span>`;
			const li = createMenuItem(innerHTML, () => {
				if (win.isMinimized) {
					windowManager.restore(windowId);
				} else {
					windowManager.focus(windowId);
				}
			});
			openWindowsList.appendChild(li);
		});
	}
	
	openWindowsBtn.addEventListener('focusin', () => {
		populateOpenWindowsMenu();
	});
}

/**
 * Sets up the canvas zoom controls.
 * @param {WindowManager} windowManager - The window manager instance.
 */
export function setupCanvasControls(windowManager) {
	const zoomInBtn = document.getElementById('zoom-in-btn');
	const zoomOutBtn = document.getElementById('zoom-out-btn');
	const zoom100Btn = document.getElementById('zoom-100-btn');
	const zoomFitBtn = document.getElementById('zoom-fit-btn');
	const arrangeBtn = document.getElementById('arrange-windows-btn');
	
	if (zoomInBtn) zoomInBtn.addEventListener('click', () => windowManager.zoomIn());
	if (zoomOutBtn) zoomOutBtn.addEventListener('click', () => windowManager.zoomOut());
	if (zoom100Btn) zoom100Btn.addEventListener('click', () => windowManager.zoomTo(1));
	if (zoomFitBtn) zoomFitBtn.addEventListener('click', () => windowManager.fitToView());
	if (arrangeBtn) arrangeBtn.addEventListener('click', () => windowManager.arrangeWindows());
}
