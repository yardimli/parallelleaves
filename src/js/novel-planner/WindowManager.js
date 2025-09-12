/**
 * Manages the creation, state, and interaction of windows in the novel editor desktop environment.
 */
export default class WindowManager {
	constructor(desktop, taskbar, novelId, viewport, novelData) {
		this.desktop = desktop;
		this.taskbar = taskbar;
		this.novelId = novelId;
		this.viewport = viewport;
		this.novelData = novelData;
		this.minimizedContainer = document.getElementById('minimized-windows-container');
		this.windows = new Map();
		this.activeWindow = null;
		this.highestZIndex = 10;
		this.windowCounter = 0;
		this.minimizedOrder = ['outline-window', 'codex-window'];
		this.selectedWindows = new Set();
		this.saveStateTimeout = null;
		this.scale = 1;
		this.panX = 0;
		this.panY = 0;
		this.isPanning = false;
		this.panStartX = 0;
		this.panStartY = 0;
		this.handleKeyDown = this.handleKeyDown.bind(this);
		this.isShiftPressed = false;
	}
	
	createWindow({id, title, content, x, y, width, height, icon, closable = true}) {
		this.windowCounter++;
		const windowId = id || `window-${this.windowCounter}`;
		
		if (this.windows.has(windowId)) {
			this.focus(windowId);
			return;
		}
		
		const win = document.createElement('div');
		win.id = windowId;
		win.className = 'window-element card bg-base-200 shadow-2xl border border-base-300 overflow-hidden absolute flex flex-col transition-all duration-100 ease-in-out';
		win.style.width = `${width}px`;
		win.style.height = `${height}px`;
		win.style.minWidth = '300px';
		win.style.minHeight = '200px';
		win.style.left = `${x}px`;
		win.style.top = `${y}px`;
		
		// This resets zoom and centers the window, same as the title bar, unless an interactive element is clicked.
		win.addEventListener('dblclick', (e) => {
			// A list of selectors for elements that should not trigger the window-wide double-click action.
			const isInteractive = e.target.closest(
				'button, a, input, textarea, .js-editable, .ProseMirror, .resize-handle, .window-title-bar, [role="button"]'
			);
			
			if (!isInteractive) {
				this.zoomTo(1);
				this.scrollIntoView(windowId);
			}
		});
		
		const isChapterWindow = windowId.startsWith('chapter-');
		// NEW: Added a check to identify individual codex entry windows.
		const isCodexEntryWindow = windowId.startsWith('codex-entry-');
		
		const titleBar = document.createElement('div');
		titleBar.className = 'window-title-bar card-title flex items-center justify-between h-10 bg-base-200/70 px-3 cursor-move border-b border-base-300 flex-shrink-0';
		
		titleBar.addEventListener('dblclick', () => {
			this.zoomTo(1);
			this.scrollIntoView(windowId);
		});
		
		const controls = document.createElement('div');
		controls.className = 'flex items-center gap-2';
		
		const controlButtons = [];
		if (closable) {
			controlButtons.push(this.createControlButton('bg-red-500', () => this.close(windowId), 'close'));
		}
		controlButtons.push(this.createControlButton('bg-yellow-500', () => this.minimize(windowId), 'minimize'));
		if (isChapterWindow) {
			controlButtons.push(this.createControlButton('bg-green-500', () => this.maximize(windowId), 'maximize'));
		}
		controls.append(...controlButtons);
		
		const titleWrapper = document.createElement('div');
		titleWrapper.className = 'flex items-center overflow-hidden';
		
		const iconEl = document.createElement('div');
		iconEl.className = 'w-5 h-5 mr-2 text-base-content/70 flex-shrink-0 flex items-center justify-center';
		iconEl.innerHTML = icon || '';
		
		const titleText = document.createElement('span');
		titleText.className = 'font-bold text-sm truncate';
		titleText.textContent = title;
		
		titleWrapper.append(iconEl, titleText);
		
		const rightSpacer = document.createElement('div');
		
		if (id === 'codex-window') {
			rightSpacer.className = 'flex items-center justify-end min-w-[64px]';
			const newEntryBtn = document.createElement('button');
			newEntryBtn.type = 'button';
			newEntryBtn.className = 'js-open-new-codex-entry btn btn-xs btn-accent gap-1 mr-2';
			newEntryBtn.innerHTML = `<i class="bi bi-plus-lg"></i> New Entry`;
			newEntryBtn.addEventListener('click', () => {
				// This opens the dedicated editor in 'new' mode.
				window.api.openNewCodexEditor({ novelId: this.novelId, selectedText: '' });
			});
			rightSpacer.appendChild(newEntryBtn);
		} else if (id === 'outline-window') {
			rightSpacer.className = 'flex items-center justify-end min-w-[64px]';
			const newChapterBtn = document.createElement('button');
			newChapterBtn.type = 'button';
			newChapterBtn.className = 'js-open-new-chapter-modal btn btn-xs btn-accent gap-1 mr-2';
			newChapterBtn.innerHTML = `<i class="bi bi-plus-lg"></i> New Chapter`;
			rightSpacer.appendChild(newChapterBtn);
		} else if (isChapterWindow) {
			rightSpacer.className = 'flex items-center justify-end min-w-[64px]';
			const editChapterBtn = document.createElement('button');
			editChapterBtn.type = 'button';
			editChapterBtn.className = 'btn btn-xs btn-ghost gap-1 mr-2';
			editChapterBtn.innerHTML = `<i class="bi bi-pencil-fill"></i> Edit`;
			editChapterBtn.title = 'Open in dedicated editor';
			editChapterBtn.addEventListener('click', () => {
				const chapterId = windowId.replace('chapter-', '');
				window.api.openChapterEditor({ novelId: this.novelId, chapterId: chapterId });
			});
			rightSpacer.appendChild(editChapterBtn);
		}
		// NEW: Added block to create an "Edit" button for individual codex entry windows.
		else if (isCodexEntryWindow) {
			rightSpacer.className = 'flex items-center justify-end min-w-[64px]';
			const editCodexBtn = document.createElement('button');
			editCodexBtn.type = 'button';
			// The `js-edit-codex-entry` class is used by the event listener in `planner-codex-events.js`.
			editCodexBtn.className = 'js-edit-codex-entry btn btn-xs btn-ghost gap-1 mr-2';
			editCodexBtn.innerHTML = `<i class="bi bi-pencil-fill"></i> Edit`;
			editCodexBtn.title = 'Open in dedicated editor';
			editCodexBtn.dataset.entryId = windowId.replace('codex-entry-', '');
			// The event listener is handled globally in planner-codex-events.js, so we don't need an inline listener here.
			rightSpacer.appendChild(editCodexBtn);
		}
		else
		{
			rightSpacer.style.width = '64px';
		}
		
		titleBar.append(controls, titleWrapper, rightSpacer);
		
		const contentArea = document.createElement('div');
		contentArea.className = 'card-body flex-grow overflow-auto p-1';
		contentArea.innerHTML = content;
		
		const modals = contentArea.querySelectorAll('dialog.modal');
		modals.forEach(modal => {
			document.body.appendChild(modal);
		});
		
		const resizeHandle = document.createElement('div');
		resizeHandle.className = 'resize-handle';
		
		win.append(titleBar, contentArea, resizeHandle);
		this.desktop.appendChild(win);
		
		const windowState = {
			element: win,
			title,
			icon,
			isMinimized: false,
			isMaximized: false,
			originalRect: {x, y, width, height},
		};
		this.windows.set(windowId, windowState);
		
		this.makeDraggable(win, titleBar);
		this.makeResizable(win, resizeHandle);
		
		win.addEventListener('mousedown', (e) => this.focus(windowId, e), true);
		
		this.focus(windowId);
		this.updateTaskbar();
		
		return windowId;
	}
	
	/**
	 * Sets the interactive state of a window's content area.
	 * @param {HTMLElement} windowElement The window element.
	 * @param {boolean} isInteractive True to enable controls, false to disable.
	 */
	_setWindowInteractive(windowElement, isInteractive) {
		const contentArea = windowElement.querySelector('.card-body');
		if (!contentArea) return;
		
		if (isInteractive) {
			contentArea.classList.remove('window-inactive-content');
		} else {
			contentArea.classList.add('window-inactive-content');
		}
	}
	
	createControlButton(colorClass, onClick, type) {
		const btn = document.createElement('button');
		btn.className = `w-3.5 h-3.5 rounded-full ${colorClass} focus:outline-none flex items-center justify-center group`;
		btn.addEventListener('click', (e) => {
			e.stopPropagation();
			onClick();
		});
		
		const icon = document.createElement('span');
		icon.className = 'text-black/50 opacity-0 group-hover:opacity-100 transition-opacity';
		let iconSvg = '';
		switch (type) {
			case 'close':
				iconSvg = '<i class="bi bi-x" style="font-size: 8px; line-height: 1;"></i>';
				break;
			case 'minimize':
				iconSvg = '<i class="bi bi-dash" style="font-size: 8px; line-height: 1;"></i>';
				break;
			case 'maximize':
				iconSvg = '<i class="bi bi-square" style="font-size: 6px; line-height: 1;"></i>';
				break;
		}
		icon.innerHTML = iconSvg;
		btn.appendChild(icon);
		
		return btn;
	}
	
	scrollIntoView(windowId) {
		const win = this.windows.get(windowId);
		if (!win || win.isMinimized) return;
		console.log('isShiftPressed:', this.isShiftPressed);
		if (this.isShiftPressed) return; // Skip auto-scroll when Shift is held.
		
		const el = win.element;
		const padding = 25;
		
		const winLeft = el.offsetLeft;
		const winTop = el.offsetTop;
		const winWidth = el.offsetWidth;
		const winHeight = el.offsetHeight;
		
		const viewLeft = (winLeft * this.scale) + this.panX;
		const viewTop = (winTop * this.scale) + this.panY;
		const winScaledWidth = winWidth * this.scale;
		const winScaledHeight = winHeight * this.scale;
		const viewRight = viewLeft + winScaledWidth;
		const viewBottom = viewTop + winScaledHeight;
		
		const viewportWidth = this.viewport.clientWidth;
		const viewportHeight = this.viewport.clientHeight;
		
		let deltaX = 0;
		let deltaY = 0;
		
		// This logic is updated to prevent "jumping" when a window is already visible
		// or is larger than the viewport's padded area, which caused oscillation.
		
		// Determine if the window is larger than the area defined by the padding.
		const isWider = winScaledWidth > (viewportWidth - 2 * padding);
		const isTaller = winScaledHeight > (viewportHeight - 2 * padding);
		
		// --- Horizontal Adjustment ---
		if (viewLeft < padding) {
			// Always adjust if the left edge is out of bounds.
			deltaX = padding - viewLeft;
		} else if (viewRight > viewportWidth - padding && !isWider) {
			// Only adjust from the right if the window is not wider than the padded area.
			// This prioritizes keeping the left edge in view for oversized windows and prevents oscillation.
			deltaX = (viewportWidth - padding) - viewRight;
		}
		
		// --- Vertical Adjustment ---
		if (viewTop < padding) {
			// Always adjust if the top edge is out of bounds.
			deltaY = padding - viewTop;
		} else if (viewBottom > viewportHeight - padding && !isTaller) {
			// Only adjust from the bottom if the window is not taller than the padded area.
			// This prioritizes keeping the top edge in view for oversized windows and prevents oscillation.
			deltaY = (viewportHeight - padding) - viewBottom;
		}
		
		const tolerance = 15;
		
		if (Math.abs(deltaX) > tolerance || Math.abs(deltaY) > tolerance) {
			this.panX += deltaX;
			this.panY += deltaY;
			this.updateCanvasTransform(true);
			this.saveState();
		}
	}
	
	focus(windowId, event = null) {
		const win = this.windows.get(windowId);
		if (!win) return;
		
		const isShiftPressed = event && event.shiftKey;
		
		// This prevents unnecessary z-index changes and taskbar redraws.
		if (this.activeWindow === windowId && !isShiftPressed) {
			return;
		}
		
		this.isShiftPressed = isShiftPressed;
		
		if (this.activeWindow && this.windows.has(this.activeWindow)) {
			const oldWin = this.windows.get(this.activeWindow);
			oldWin.element.classList.remove('active');
			this._setWindowInteractive(oldWin.element, false);
		}
		
		win.element.style.zIndex = this.highestZIndex++;
		win.element.classList.add('active');
		this._setWindowInteractive(win.element, true);
		this.activeWindow = windowId;
		
		if (isShiftPressed) {
			if (this.selectedWindows.has(windowId)) {
				this.selectedWindows.delete(windowId);
				win.element.classList.remove('selected');
			} else {
				this.selectedWindows.add(windowId);
				win.element.classList.add('selected');
			}
		} else {
			if (!this.selectedWindows.has(windowId)) {
				this._clearSelection();
				this.selectedWindows.add(windowId);
				win.element.classList.add('selected');
			}
		}
		
		this.updateTaskbar();
		this.saveState();
	}
	
	close(windowId) {
		const win = this.windows.get(windowId);
		if (win) {
			win.element.remove();
			this.windows.delete(windowId);
			this.selectedWindows.delete(windowId);
			
			if (windowId.startsWith('codex-entry-')) {
				const entryId = windowId.replace('codex-entry-', '');
				const aiModal = document.getElementById(`ai-modal-${entryId}`);
				const uploadModal = document.getElementById(`upload-modal-${entryId}`);
				if (aiModal) aiModal.remove();
				if (uploadModal) uploadModal.remove();
			}
			
			this.updateTaskbar();
			this.saveState();
		}
	}
	
	minimize(windowId) {
		const win = this.windows.get(windowId);
		if (!win || win.isMinimized) return;
		
		if (!win.isMaximized) {
			win.originalRect = {
				x: win.element.offsetLeft,
				y: win.element.offsetTop,
				width: win.element.offsetWidth,
				height: win.element.offsetHeight
			};
		}
		
		win.isMinimized = true;
		win.element.classList.add('hidden');
		win.element.classList.remove('selected');
		this.selectedWindows.delete(windowId);
		
		if (this.activeWindow === windowId) {
			this.activeWindow = null;
		}
		
		this.updateTaskbar();
		this.saveState();
	}
	
	restore(windowId) {
		const win = this.windows.get(windowId);
		if (!win || !win.isMinimized) return;
		
		win.isMinimized = false;
		win.element.classList.remove('hidden');
		this.focus(windowId);
		this.saveState();
	}
	
	maximize(windowId) {
		const win = this.windows.get(windowId);
		if (!win) return;
		
		if (win.isMaximized) {
			win.element.style.width = `${win.originalRect.width}px`;
			win.element.style.height = `${win.originalRect.height}px`;
			win.element.style.left = `${win.originalRect.x}px`;
			win.element.style.top = `${win.originalRect.y}px`;
			win.isMaximized = false;
		} else {
			win.originalRect = {
				x: win.element.offsetLeft,
				y: win.element.offsetTop,
				width: win.element.offsetWidth,
				height: win.element.offsetHeight
			};
			
			this.scale = 1;
			
			const maxW = Math.min(this.viewport.clientWidth * 0.9, 1600);
			const maxH = Math.min((this.viewport.clientHeight - this.taskbar.offsetHeight) * 0.9, 1200);
			
			win.element.style.width = `${maxW}px`;
			win.element.style.height = `${maxH}px`;
			
			win.isMaximized = true;
			setTimeout(() => {
				this.scrollIntoView(windowId);
			}, 250);
		}
		this.saveState();
	}
	
	/**
	 * This method now includes logic to auto-pan the viewport when a window is dragged to the edge.
	 * It uses requestAnimationFrame for smooth, continuous panning and a unified positioning logic
	 * to keep the window attached to the cursor during both drag and pan operations.
	 * @param {HTMLElement} win - The window element to make draggable.
	 * @param {HTMLElement} handle - The element that acts as the drag handle (e.g., the title bar).
	 */
	makeDraggable(win, handle) {
		let panRequest = null;
		let panDirection = {x: 0, y: 0};
		let lastMouseEvent = null;
		
		// Unified function to calculate and apply window positions.
		// This is used by both onMouseMove and the panLoop to prevent conflicting state updates.
		const positionWindows = (e) => {
			this.selectedWindows.forEach(id => {
				const currentWinEl = this.windows.get(id).element;
				// Calculate the new top-left corner of the window in desktop coordinates.
				// It's based on the current mouse position, the current pan/scale of the canvas,
				// and the initial offset from the cursor to the window's corner.
				let newLeft = (e.clientX - this.panX) / this.scale - currentWinEl.dragOffsetX;
				let newTop = (e.clientY - this.panY) / this.scale - currentWinEl.dragOffsetY;
				
				// Clamp the position to stay within the desktop boundaries.
				const desktopWidth = this.desktop.offsetWidth;
				const desktopHeight = this.desktop.offsetHeight;
				const winWidth = currentWinEl.offsetWidth;
				const winHeight = currentWinEl.offsetHeight;
				
				newLeft = Math.max(0, Math.min(newLeft, desktopWidth - winWidth));
				newTop = Math.max(0, Math.min(newTop, desktopHeight - winHeight));
				
				currentWinEl.style.left = `${newLeft}px`;
				currentWinEl.style.top = `${newTop}px`;
			});
		};
		
		// The main loop for auto-panning, driven by requestAnimationFrame.
		const panLoop = () => {
			if (panDirection.x === 0 && panDirection.y === 0) {
				stopAutoPan();
				return;
			}
			
			const panSpeed = 10; // Pan speed in pixels per frame.
			this.panX += panDirection.x * panSpeed;
			this.panY += panDirection.y * panSpeed;
			this.updateCanvasTransform();
			
			// Re-position windows using the last known mouse event and the new pan values.
			// This is crucial to keep the window "stuck" to the cursor while the canvas moves underneath.
			if (lastMouseEvent) {
				positionWindows(lastMouseEvent);
			}
			
			panRequest = requestAnimationFrame(panLoop);
		};
		
		const startAutoPan = () => {
			if (panRequest) return; // Already running.
			panRequest = requestAnimationFrame(panLoop);
		};
		
		const stopAutoPan = () => {
			if (panRequest) {
				cancelAnimationFrame(panRequest);
				panRequest = null;
			}
		};
		
		const onMouseMove = (e) => {
			lastMouseEvent = e; // Keep track of the latest mouse event.
			positionWindows(e); // Update window positions based on mouse movement.
			
			// Check if the cursor is near the viewport edge to determine pan direction.
			const edgeZone = 50; // 50px trigger zone from the edge.
			const viewportRect = this.viewport.getBoundingClientRect();
			panDirection = {x: 0, y: 0};
			
			if (e.clientX < viewportRect.left + edgeZone) {
				panDirection.x = 1; // Pan right (revealing content on the left).
			} else if (e.clientX > viewportRect.right - edgeZone) {
				panDirection.x = -1; // Pan left.
			}
			
			if (e.clientY < viewportRect.top + edgeZone) {
				panDirection.y = 1; // Pan down.
			} else if (e.clientY > viewportRect.bottom - edgeZone) {
				panDirection.y = -1; // Pan up.
			}
			
			// Start or stop the panning loop based on cursor position.
			if (panDirection.x !== 0 || panDirection.y !== 0) {
				startAutoPan();
			} else {
				stopAutoPan();
			}
		};
		
		const onMouseUp = () => {
			win.classList.remove('dragging');
			document.removeEventListener('mousemove', onMouseMove);
			document.removeEventListener('mouseup', onMouseUp);
			document.removeEventListener('mouseleave', onMouseUp);
			
			stopAutoPan(); // Ensure the auto-pan stops when the drag ends.
			lastMouseEvent = null; // Clean up stored event.
			
			this.selectedWindows.forEach(id => {
				const winState = this.windows.get(id);
				if (winState && !winState.isMaximized) {
					winState.originalRect.x = winState.element.offsetLeft;
					winState.originalRect.y = winState.element.offsetTop;
				}
			});
			
			this.saveState();
		};
		
		handle.addEventListener('mousedown', (e) => {
			const winState = this.windows.get(win.id);
			if (winState && winState.isMaximized) return;
			
			win.classList.add('dragging');
			lastMouseEvent = e; // Store initial mouse event.
			
			// For each selected window, calculate and store the offset from its top-left corner
			// to the mouse cursor, in unscaled desktop coordinates. This offset remains constant during the drag.
			this.selectedWindows.forEach(id => {
				const currentWinEl = this.windows.get(id).element;
				currentWinEl.dragOffsetX = (e.clientX - this.panX) / this.scale - currentWinEl.offsetLeft;
				currentWinEl.dragOffsetY = (e.clientY - this.panY) / this.scale - currentWinEl.offsetTop;
			});
			
			document.addEventListener('mousemove', onMouseMove);
			document.addEventListener('mouseup', onMouseUp);
			document.addEventListener('mouseleave', onMouseUp);
		});
	}
	
	makeResizable(win, handle) {
		let startX, startY, startWidth, startHeight;
		
		const onMouseMove = (e) => {
			let newWidth = startWidth + (e.clientX - startX) / this.scale;
			let newHeight = startHeight + (e.clientY - startY) / this.scale;
			
			const maxW = Math.min(this.viewport.clientWidth / this.scale, 1600);
			const maxH = Math.min(this.viewport.clientHeight / this.scale, 1200);
			
			newWidth = Math.min(newWidth, maxW);
			newHeight = Math.min(newHeight, maxH);
			
			if (win.offsetLeft + newWidth > this.desktop.offsetWidth) {
				newWidth = this.desktop.offsetWidth - win.offsetLeft;
			}
			if (win.offsetTop + newHeight > this.desktop.offsetHeight) {
				newHeight = this.desktop.offsetHeight - win.offsetTop;
			}
			
			win.style.width = `${newWidth}px`;
			win.style.height = `${newHeight}px`;
		};
		
		const onMouseUp = () => {
			win.classList.remove('dragging');
			document.removeEventListener('mousemove', onMouseMove);
			document.removeEventListener('mouseup', onMouseUp);
			
			const winState = this.windows.get(win.id);
			if (winState && !winState.isMaximized) {
				winState.originalRect.width = win.offsetWidth;
				winState.originalRect.height = win.offsetHeight;
			}
			
			this.saveState();
		};
		
		handle.addEventListener('mousedown', (e) => {
			e.preventDefault();
			win.classList.add('dragging');
			
			startX = e.clientX;
			startY = e.clientY;
			startWidth = parseInt(document.defaultView.getComputedStyle(win).width, 10);
			startHeight = parseInt(document.defaultView.getComputedStyle(win).height, 10);
			document.addEventListener('mousemove', onMouseMove);
			document.addEventListener('mouseup', onMouseUp);
		});
	}
	
	saveState() {
		if (this.saveStateTimeout) {
			clearTimeout(this.saveStateTimeout);
		}
		
		this.saveStateTimeout = setTimeout(() => {
			this._performSaveState();
		}, 1000);
	}
	
	async _performSaveState() {
		const windowsState = [];
		this.windows.forEach((win, id) => {
			windowsState.push({
				id: id,
				title: win.title,
				icon: win.icon,
				x: win.originalRect.x,
				y: win.originalRect.y,
				width: win.originalRect.width,
				height: win.originalRect.height,
				zIndex: parseInt(win.element.style.zIndex, 10),
				isMinimized: win.isMinimized,
				isMaximized: win.isMaximized
			});
		});
		
		const canvasState = {
			scale: this.scale,
			panX: this.panX,
			panY: this.panY
		};
		
		const fullState = {
			windows: windowsState,
			canvas: canvasState
		};
		
		try {
			await window.api.saveEditorState(this.novelId, fullState);
		} catch (error) {
			console.error('Error saving editor state:', error);
		}
	}
	
	async loadState() {
		const stateJSON = document.body.dataset.editorState;
		let savedState = null;
		
		if (stateJSON && stateJSON !== 'null') {
			try {
				savedState = JSON.parse(stateJSON);
			} catch (e) {
				console.error('Failed to parse editor state:', e);
			}
		}
		
		let windowsCreated = false;
		
		if (savedState && savedState.windows && savedState.windows.length > 0) {
			const windows = savedState.windows;
			windows.sort((a, b) => a.zIndex - b.zIndex);
			
			for (const state of windows) {
				let content = '';
				let closable = true;
				
				try {
					if (state.id === 'outline-window') {
						content = document.body.dataset.outlineContent;
						closable = false;
					} else if (state.id === 'codex-window') {
						content = document.body.dataset.codexContent;
						closable = false;
					} else if (state.id.startsWith('codex-entry-')) {
						const entryId = state.id.replace('codex-entry-', '');
						content = await window.api.getCodexEntryHtml(entryId);
					} else if (state.id.startsWith('chapter-')) {
						const chapterId = state.id.replace('chapter-', '');
						content = await window.api.getChapterHtml(chapterId);
					}
				} catch (e) {
					console.error(`Error loading content for window ${state.id}:`, e);
					content = `<p class="p-4 text-error">Error loading content.</p>`;
				}
				
				if (content) {
					this.createWindow({
						id: state.id,
						title: state.title,
						content: content,
						x: state.x,
						y: state.y,
						width: state.width,
						height: state.height,
						icon: state.icon,
						closable: closable
					});
					
					const win = this.windows.get(state.id);
					if (win) {
						win.element.style.zIndex = state.zIndex;
						win.originalRect = {x: state.x, y: state.y, width: state.width, height: state.height};
						if (state.isMaximized) this.maximize(state.id);
						if (state.isMinimized) this.minimize(state.id);
					}
				}
			}
			const maxZ = Math.max(...windows.map(w => w.zIndex || 0), 10);
			this.highestZIndex = maxZ + 1;
			windowsCreated = true;
		}
		
		if (!windowsCreated) {
			this.createDefaultWindows();
		}
		
		if (savedState && savedState.canvas) {
			this.scale = savedState.canvas.scale || 1;
			this.panX = savedState.canvas.panX || 0;
			this.panY = savedState.canvas.panY || 0;
			this.updateCanvasTransform();
		} else {
			this.fitToView(false);
		}
	}
	
	updateTaskbar() {
		// 1. Determine the desired state: which items should be in the taskbar and in what order.
		const taskbarItems = new Map();
		
		// Add minimized windows.
		this.windows.forEach((win, id) => {
			if (win.isMinimized) {
				taskbarItems.set(id, {id, title: win.title, icon: win.icon});
			}
		});
		
		// Always ensure outline and codex windows are represented.
		// The Map structure automatically prevents duplicates if they are already added (i.e., minimized).
		['outline-window', 'codex-window'].forEach(id => {
			if (this.windows.has(id)) {
				const win = this.windows.get(id);
				taskbarItems.set(id, {id, title: win.title, icon: win.icon});
			}
		});
		
		// Sort the items into the final display order.
		const sortedItems = Array.from(taskbarItems.values()).sort((a, b) => {
			const order = this.minimizedOrder;
			const indexA = order.indexOf(a.id);
			const indexB = order.indexOf(b.id);
			
			if (indexA !== -1 && indexB !== -1) return indexA - indexB;
			if (indexA !== -1) return -1;
			if (indexB !== -1) return 1;
			return a.title.localeCompare(b.title);
		});
		
		// 2. Reconcile the desired state with the current DOM.
		const desiredIds = new Set(sortedItems.map(item => item.id));
		const currentElements = new Map();
		const elementsToRemove = [];
		
		// Identify what's currently in the DOM and which elements are obsolete.
		for (const child of this.minimizedContainer.children) {
			const windowId = child.dataset.windowId;
			if (desiredIds.has(windowId)) {
				currentElements.set(windowId, child);
			} else {
				elementsToRemove.push(child);
			}
		}
		
		// Remove obsolete elements from the DOM.
		elementsToRemove.forEach(el => el.remove());
		
		// 3. Update, create, and re-order the necessary elements.
		let lastElement = null; // Used to track the correct position for insertion.
		sortedItems.forEach(item => {
			const windowId = item.id;
			const win = this.windows.get(windowId);
			let taskbarItem = currentElements.get(windowId);
			
			// Create the element if it's new.
			if (!taskbarItem) {
				taskbarItem = document.createElement('button');
				taskbarItem.dataset.windowId = windowId;
				taskbarItem.addEventListener('click', () => {
					const currentWin = this.windows.get(windowId); // Get a fresh reference on click.
					if (currentWin.isMinimized) {
						this.restore(windowId);
					} else {
						this.focus(windowId);
						this.scrollIntoView(windowId);
					}
				});
			}
			
			// Update properties for both new and existing elements to keep them in sync.
			taskbarItem.className = 'window-minimized btn btn-sm h-10 flex-shrink min-w-[120px] max-w-[256px] flex-grow basis-0 justify-start';
			if (!win.isMinimized && windowId === this.activeWindow) {
				taskbarItem.classList.add('btn-active', 'btn-primary');
			} else if (!win.isMinimized) {
				taskbarItem.classList.add('bg-base-400', 'hover:bg-base-500');
			} else {
				taskbarItem.classList.add('btn-ghost');
			}
			taskbarItem.innerHTML = `<div class="w-5 h-5 flex-shrink-0 flex items-center justify-center">${item.icon || ''}</div><span class="truncate normal-case font-semibold">${item.title}</span>`;
			
			// Ensure the element is in the correct position in the DOM.
			// This efficiently moves existing elements if their order has changed.
			const expectedNextSibling = lastElement ? lastElement.nextSibling : this.minimizedContainer.firstChild;
			if (taskbarItem !== expectedNextSibling) {
				this.minimizedContainer.insertBefore(taskbarItem, expectedNextSibling);
			}
			
			lastElement = taskbarItem;
		});
	}
	
	createDefaultWindows() {
		const outlineIcon = `<i class="bi bi-list-columns-reverse text-lg"></i>`;
		const codexIcon = `<i class="bi bi-book-half text-lg"></i>`;
		
		const canvasCenterX = 2500;
		const canvasCenterY = 2500;
		
		const outlineContent = document.body.dataset.outlineContent;
		if (outlineContent) {
			this.createWindow({
				id: 'outline-window',
				title: 'Novel Outline',
				content: outlineContent,
				x: canvasCenterX - 520,
				y: canvasCenterY - 300,
				width: 500,
				height: 600,
				icon: outlineIcon,
				closable: false
			});
		}
		
		const codexContent = document.body.dataset.codexContent;
		if (codexContent) {
			this.createWindow({
				id: 'codex-window',
				title: 'Codex',
				content: codexContent,
				x: canvasCenterX + 20,
				y: canvasCenterY - 270,
				width: 450,
				height: 550,
				icon: codexIcon,
				closable: false
			});
		}
	}
	
	// --- CANVAS PAN AND ZOOM METHODS ---
	
	initCanvas() {
		this.viewport.addEventListener('wheel', this.handleZoom.bind(this), {passive: false});
		this.viewport.addEventListener('mousedown', this.handlePanStart.bind(this));
		this.viewport.addEventListener('mousemove', this.handlePanMove.bind(this));
		this.viewport.addEventListener('mouseup', this.handlePanEnd.bind(this));
		this.viewport.addEventListener('mouseleave', this.handlePanEnd.bind(this));
		document.addEventListener('keydown', this.handleKeyDown);
	}
	
	updateCanvasTransform(animated = false) {
		this.desktop.style.transition = animated ? 'transform 0.3s ease, top 0.3s ease, left 0.3s ease' : 'none';
		this.desktop.style.transform = `scale(${this.scale})`;
		this.desktop.style.left = `${this.panX}px`;
		this.desktop.style.top = `${this.panY}px`;
	}
	
	handleZoom(event) {
		const scrollContainer = event.target.closest('.overflow-auto, .overflow-y-auto');
		
		if (scrollContainer) {
			const hasVerticalScroll = scrollContainer.scrollHeight > scrollContainer.clientHeight;
			const hasHorizontalScroll = scrollContainer.scrollWidth > scrollContainer.clientWidth;
			
			if (hasVerticalScroll || hasHorizontalScroll) {
				return;
			}
		}
		
		event.preventDefault();
		const zoomIntensity = 0.01;
		const delta = event.deltaY > 0 ? -zoomIntensity : zoomIntensity;
		const newScale = Math.max(0.1, Math.min(1.5, this.scale + delta * this.scale));
		
		const viewportRect = this.viewport.getBoundingClientRect();
		const mouseX = event.clientX - viewportRect.left;
		const mouseY = event.clientY - viewportRect.top;
		
		const mousePointX = (mouseX - this.panX) / this.scale;
		const mousePointY = (mouseY - this.panY) / this.scale;
		
		this.panX = mouseX - mousePointX * newScale;
		this.panY = mouseY - mousePointY * newScale;
		this.scale = newScale;
		
		this.updateCanvasTransform();
		this.saveState();
	}
	
	handlePanStart(event) {
		if (event.target === this.desktop) {
			if (this.activeWindow && this.windows.has(this.activeWindow)) {
				const oldWin = this.windows.get(this.activeWindow);
				oldWin.element.classList.remove('active');
				this._setWindowInteractive(oldWin.element, false);
				this.activeWindow = null;
				this.updateTaskbar(); // Update taskbar to show no active window
			}
			this._clearSelection();
			this.isPanning = true;
			this.panStartX = event.clientX - this.panX;
			this.panStartY = event.clientY - this.panY;
			this.viewport.classList.add('panning');
		}
	}
	
	handlePanMove(event) {
		if (this.isPanning) {
			this.panX = event.clientX - this.panStartX;
			this.panY = event.clientY - this.panStartY;
			this.updateCanvasTransform();
		}
	}
	
	handlePanEnd() {
		if (this.isPanning) {
			this.isPanning = false;
			this.viewport.classList.remove('panning');
			this.saveState();
		}
	}
	
	zoomIn() {
		this.scale = Math.min(1.5, this.scale * 1.2);
		this.updateCanvasTransform(true);
		this.saveState();
	}
	
	zoomOut() {
		this.scale = Math.max(0.1, this.scale / 1.2);
		this.updateCanvasTransform(true);
		this.saveState();
	}
	
	zoomTo(targetScale, animated = true) {
		const viewportCenterX = this.viewport.clientWidth / 2;
		const viewportCenterY = this.viewport.clientHeight / 2;
		
		const canvasPointX = (viewportCenterX - this.panX) / this.scale;
		const canvasPointY = (viewportCenterY - this.panY) / this.scale;
		
		this.scale = targetScale;
		
		this.panX = viewportCenterX - (canvasPointX * this.scale);
		this.panY = viewportCenterY - (canvasPointY * this.scale);
		
		this.updateCanvasTransform(animated);
		this.saveState();
	}
	
	fitToView(animated = true) {
		if (this.windows.size === 0) return;
		
		let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
		
		this.windows.forEach(win => {
			if (win.isMinimized) return;
			const el = win.element;
			minX = Math.min(minX, el.offsetLeft);
			minY = Math.min(minY, el.offsetTop);
			maxX = Math.max(maxX, el.offsetLeft + el.offsetWidth);
			maxY = Math.max(maxY, el.offsetTop + el.offsetHeight);
		});
		
		if (!isFinite(minX)) return;
		
		const contentWidth = maxX - minX;
		const contentHeight = maxY - minY;
		const padding = 100;
		
		const viewportWidth = this.viewport.clientWidth;
		const viewportHeight = this.viewport.clientHeight;
		
		const scaleX = viewportWidth / (contentWidth + padding * 2);
		const scaleY = viewportHeight / (contentHeight + padding * 2);
		this.scale = Math.min(1.5, scaleX, scaleY);
		
		const contentCenterX = minX + contentWidth / 2;
		const contentCenterY = minY + contentHeight / 2;
		
		this.panX = (viewportWidth / 2) - (contentCenterX * this.scale);
		this.panY = (viewportHeight / 2) - (contentCenterY * this.scale);
		
		this.updateCanvasTransform(animated);
		this.saveState();
	}
	
	_clearSelection() {
		this.selectedWindows.forEach(id => {
			const win = this.windows.get(id);
			if (win) {
				win.element.classList.remove('selected');
			}
		});
		this.selectedWindows.clear();
		this.updateTaskbar();
	}
	
	reposition(windowId, x, y, width, height) {
		const win = this.windows.get(windowId);
		if (!win) return;
		
		if (win.isMinimized) {
			this.restore(windowId);
		}
		
		win.element.style.left = `${x}px`;
		win.element.style.top = `${y}px`;
		win.element.style.width = `${width}px`;
		win.element.style.height = `${height}px`;
		
		win.isMaximized = false;
		win.originalRect = {x, y, width, height};
		
		this.focus(windowId);
	}
	
	handleKeyDown(event) {
		if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'm') {
			if (this.activeWindow) {
				event.preventDefault();
				const win = this.windows.get(this.activeWindow);
				if (win && !win.isMinimized) {
					this.minimize(this.activeWindow);
				}
			}
		}
	}
	
	arrangeWindows() {
		if (!this.novelData) {
			console.error('Cannot arrange windows: novel data is not available.');
			return;
		}
		
		const PADDING = 50;
		const COL_GAP = 40;
		const ROW_GAP = 40;
		
		const SML_WIN_W = 400;
		const SML_WIN_H = 400;
		const LRG_WIN_W = 400;
		const LRG_WIN_H = 1000;
		
		let currentX = PADDING;
		const currentY = PADDING;
		
		// 1. Position Codex Window
		if (this.windows.has('codex-window')) {
			this.reposition('codex-window', currentX, currentY, LRG_WIN_W, LRG_WIN_H);
		}
		currentX += LRG_WIN_W + COL_GAP;
		
		// 2. Position Codex Entries
		const openCodexWindows = new Map();
		this.windows.forEach((win, id) => {
			if (id.startsWith('codex-entry-')) {
				const entryId = id.replace('codex-entry-', '');
				openCodexWindows.set(entryId, id);
			}
		});
		
		if (openCodexWindows.size > 0) {
			const codexCategories = this.novelData.codexCategories || [];
			const charactersCategory = codexCategories.find(c => c.name.toLowerCase() === 'characters');
			const locationsCategory = codexCategories.find(c => c.name.toLowerCase() === 'locations');
			const othersCategory = codexCategories.find(c => c.name.toLowerCase() !== 'characters' && c.name.toLowerCase() !== 'locations');
			
			// Column 1: Characters
			let hasPositionedInCol1 = false;
			if (charactersCategory && charactersCategory.entries) {
				let colY = currentY;
				for (const entry of charactersCategory.entries) {
					if (openCodexWindows.has(String(entry.id))) {
						const windowId = openCodexWindows.get(String(entry.id));
						this.reposition(windowId, currentX, colY, SML_WIN_W, SML_WIN_H);
						colY += SML_WIN_H + ROW_GAP;
						hasPositionedInCol1 = true;
					}
				}
			}
			if (hasPositionedInCol1) {
				currentX += SML_WIN_W + COL_GAP;
			}
			
			// Column 2: Locations
			let hasPositionedInCol2 = false;
			if (locationsCategory && locationsCategory.entries) {
				let colY = currentY;
				for (const entry of locationsCategory.entries) {
					if (openCodexWindows.has(String(entry.id))) {
						const windowId = openCodexWindows.get(String(entry.id));
						this.reposition(windowId, currentX, colY, SML_WIN_W, SML_WIN_H);
						colY += SML_WIN_H + ROW_GAP;
						hasPositionedInCol2 = true;
					}
				}
			}
			if (hasPositionedInCol2) {
				currentX += SML_WIN_W + COL_GAP;
			}
			
			// Column 2: Others
			let hasPositionedInCol3 = false;
			if (othersCategory && othersCategory.entries) {
				let colY = currentY;
				for (const entry of othersCategory.entries) {
					if (openCodexWindows.has(String(entry.id))) {
						const windowId = openCodexWindows.get(String(entry.id));
						this.reposition(windowId, currentX, colY, SML_WIN_W, SML_WIN_H);
						colY += SML_WIN_H + ROW_GAP;
						hasPositionedInCol3 = true;
					}
				}
			}
			if (hasPositionedInCol3) {
				currentX += SML_WIN_W + COL_GAP;
			}
		}
		
		// 3. Position Outline Window
		if (this.windows.has('outline-window')) {
			this.reposition('outline-window', currentX, currentY, LRG_WIN_W, LRG_WIN_H);
		}
		currentX += LRG_WIN_W + COL_GAP;
		
		// 4. Position Chapter Windows
		const openChapterWindows = new Map();
		this.windows.forEach((win, id) => {
			if (id.startsWith('chapter-')) {
				const chapterId = id.replace('chapter-', '');
				openChapterWindows.set(chapterId, id);
			}
		});
		
		if (openChapterWindows.size > 0) {
			const sections = this.novelData.sections || [];
			for (const section of sections) {
				let chapterColY = currentY;
				if (section.chapters && section.chapters.length > 0) {
					let chaptersInSectionAreOpen = false;
					for (const chapter of section.chapters) {
						if (openChapterWindows.has(String(chapter.id))) {
							chaptersInSectionAreOpen = true;
							const windowId = openChapterWindows.get(String(chapter.id));
							this.reposition(windowId, currentX, chapterColY, SML_WIN_W, SML_WIN_H);
							chapterColY += SML_WIN_H + ROW_GAP;
						}
					}
					if (chaptersInSectionAreOpen) {
						currentX += SML_WIN_W + COL_GAP;
					}
				}
			}
		}
		
		// 5. Fit view to show all arranged windows.
		this.fitToView();
	}
}
