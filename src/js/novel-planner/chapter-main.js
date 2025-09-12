import { setupTopToolbar } from './toolbar.js';
import { setupPromptEditor } from '../prompt-editor.js';
import { EditorState, Plugin } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { DOMParser, DOMSerializer } from 'prosemirror-model';
import { history, undo, redo } from 'prosemirror-history';
import { keymap } from 'prosemirror-keymap';
import { baseKeymap } from 'prosemirror-commands';
import { schema, NoteNodeView, getActiveEditor, setActiveEditor } from './content-editor.js';
import { updateToolbarState } from './toolbar.js';

// NEW: Debouncing utility to delay function execution until after a pause.
const debounce = (func, delay) => {
	let timeout;
	return function(...args) {
		const context = this;
		clearTimeout(timeout);
		timeout = setTimeout(() => func.apply(context, args), delay);
	};
};

let activeChapterId = null;
let isScrollingProgrammatically = false;
const chapterEditorViews = new Map();


/**
 * Creates a ProseMirror editor view instance.
 * @param {HTMLElement} mount - The element to mount the editor in.
 * @param {string} initialHtml - The initial HTML content.
 * @param {boolean} isEditable - Whether the editor should be editable.
 * @param {string} chapterId - The chapter ID for saving.
 * @param {string} saveField - The database field to save to.
 * @returns {EditorView}
 */
function createEditorView(mount, initialHtml, isEditable, chapterId, saveField) {
	console.log(`[createEditorView] Initializing for chapter ${chapterId}, field: ${saveField}`);
	const debouncedContentSave = debounce(async (view) => {
		console.log(`[SAVE] Debounced save triggered for ${saveField}, chapter ${chapterId}...`);
		if (saveField === 'target_content') {
			const wordCount = view.state.doc.textContent.trim().split(/\s+/).filter(Boolean).length;
			const wordCountEl = mount.closest('.manuscript-chapter-item').querySelector('.js-target-word-count');
			if (wordCountEl) {
				wordCountEl.textContent = `${wordCount.toLocaleString()} words`;
			}
		}
		
		const serializer = DOMSerializer.fromSchema(view.state.schema);
		const fragmentContent = serializer.serializeFragment(view.state.doc.content);
		const tempDiv = document.createElement('div');
		tempDiv.appendChild(fragmentContent);
		const value = tempDiv.innerHTML;
		try {
			await window.api.updateChapterField({ chapterId, field: saveField, value });
			console.log(`[SAVE] Successfully saved ${saveField} for chapter ${chapterId}.`);
		} catch (error) {
			console.error(`[SAVE] Error saving ${saveField} for chapter ${chapterId}:`, error);
			window.showAlert(`Could not save ${saveField} changes.`);
		}
	}, 2000); // 2 second delay
	
	const noteProtectionPlugin = new Plugin({
		// This part improves the user experience for single key presses (Backspace/Delete).
		props: {
			handleKeyDown(view, event) {
				if (event.key !== 'Backspace' && event.key !== 'Delete') {
					return false;
				}
				console.log(`[noteProtectionPlugin] Keydown detected: ${event.key}`);
				
				const { $from, empty } = view.state.selection;
				if (!empty) {
					return false;
				}
				
				let adjacentNode;
				if (event.key === 'Backspace') {
					if ($from.parentOffset === 0) {
						const nodeBefore = view.state.doc.resolve($from.pos - 1).nodeBefore;
						if (nodeBefore && nodeBefore.type.name === 'note') {
							adjacentNode = nodeBefore;
						}
					}
				} else { // 'Delete'
					if ($from.parentOffset === $from.parent.content.size) {
						const nodeAfter = view.state.doc.nodeAt($from.pos);
						if (nodeAfter && nodeAfter.type.name === 'note') {
							adjacentNode = nodeAfter;
						}
					}
				}
				
				if (adjacentNode) {
					console.log('[noteProtectionPlugin] Preventing deletion of adjacent note node via keydown.');
					return true;
				}
				
				return false;
			},
		},
		// This part provides a rock-solid guarantee that no transaction can delete a note.
		filterTransaction(tr, state) {
			if (!tr.docChanged) {
				return true;
			}
			
			let noteDeleted = false;
			state.doc.descendants((node, pos) => {
				if (node.type.name === 'note') {
					if (tr.mapping.mapResult(pos).deleted) {
						noteDeleted = true;
					}
				}
			});
			
			if (noteDeleted) {
				console.warn('[noteProtectionPlugin] Blocking transaction that would delete a note node.');
			}
			return !noteDeleted;
		},
	});
	
	const editorPlugin = new Plugin({
		props: {
			editable: () => isEditable,
			handleDOMEvents: {
				focus(view) {
					console.log(`[EditorEvent] Focus on chapter ${chapterId}, field: ${saveField}`);
					setActiveEditor(view);
					updateToolbarState(view);
					const chapterItem = view.dom.closest('.manuscript-chapter-item');
					if (chapterItem) {
						const currentChapterId = chapterItem.dataset.chapterId;
						if (currentChapterId && currentChapterId !== activeChapterId) {
							console.log(`[EditorEvent] Active chapter changed to ${currentChapterId} via focus.`);
							activeChapterId = currentChapterId;
							document.getElementById('js-chapter-nav-dropdown').value = currentChapterId;
						}
					}
				},
				blur(view, event) {
					const relatedTarget = event.relatedTarget;
					console.log(`[EditorEvent] Blur on chapter ${chapterId}. Related target:`, relatedTarget);
					if (!relatedTarget || (!relatedTarget.closest('#top-toolbar') && !relatedTarget.closest('#note-editor-modal'))) {
						setActiveEditor(null);
						updateToolbarState(null);
					}
				},
			},
		},
	});
	
	const doc = DOMParser.fromSchema(schema).parse(document.createRange().createContextualFragment(initialHtml || ''));
	
	const debouncedToolbarUpdate = debounce((view) => {
		console.log(`[dispatchTransaction] Debounced: Updating toolbar state for chapter ${chapterId}`);
		updateToolbarState(view);
	}, 200); // 200ms delay
	
	return new EditorView(mount, {
		state: EditorState.create({
			attributes: {
				spellcheck: 'false',
			},
			doc: doc,
			plugins: [
				history(),
				keymap({ 'Mod-z': undo, 'Mod-y': redo }),
				keymap(baseKeymap),
				editorPlugin,
				noteProtectionPlugin,
			],
		}),
		nodeViews: {
			note(node, view, getPos) { return new NoteNodeView(node, view, getPos); }
		},
		dispatchTransaction(transaction) {
			console.log(`[dispatchTransaction] Chapter ${chapterId}, DocChanged: ${transaction.docChanged}, SelectionSet: ${transaction.selectionSet}`);

			const newState = this.state.apply(transaction);
			this.updateState(newState);
			
			if (isEditable && transaction.docChanged) {
				debouncedContentSave(this);
			}
			
			if (transaction.selectionSet || transaction.docChanged) {
				if (this.hasFocus()) {
					debouncedToolbarUpdate(this);
				}
			}
		},
	});
}

/**
 * Replaces {{TranslationBlock-X}} placeholders with styled HTML divs for display.
 * @param {string} sourceHtml - The raw HTML from the database.
 * @returns {string} HTML with placeholders replaced by styled divs.
 */
function processSourceContentForDisplay(sourceHtml) {
	console.log('[processSourceContent] Processing source HTML for display.');
	if (!sourceHtml) return '';
	// This regex finds all instances of {{TranslationBlock-NUMBER}} and replaces them.
	return sourceHtml.replace(/{{TranslationBlock-(\d+)}}/g, (match, blockNumber) => {
		const stylingClasses = 'note-wrapper not-prose p-1 my-1 border-l-4 border-yellow-400 bg-yellow-50 dark:bg-yellow-900/20 dark:border-yellow-600 rounded-r-md flex justify-between items-center';
		return `<div class="${stylingClasses}" data-block-number="${blockNumber}">
                    <p class="m-0 text-sm font-semibold">Translation Block #${blockNumber}</p>
                    <button type="button" class="js-translate-block-btn btn btn-xs btn-ghost gap-1" title="Translate this block">
                        <i class="bi bi-translate"></i> Translate
                    </button>
                </div>`;
	});
}

/**
 * Renders the entire manuscript into the container.
 * @param {HTMLElement} container - The manuscript container element.
 * @param {object} novelData - The full novel data.
 */
async function renderManuscript(container, novelData) {
	console.time('renderManuscript');
	console.log('[renderManuscript] Starting manuscript render...');
	const fragment = document.createDocumentFragment();
	const chapterCodexTagTemplate = await window.api.getTemplate('chapter/chapter-codex-tag');
	
	for (const section of novelData.sections) {
		console.log(`[renderManuscript] Rendering section "${section.title}"`);
		const sectionHeader = document.createElement('div');
		sectionHeader.className = 'px-8 py-6 sticky top-0 bg-base-100/90 backdrop-blur-sm z-10 border-b border-base-300';
		sectionHeader.innerHTML = `<h2 class="text-3xl font-bold text-indigo-500">${section.section_order}. ${section.title}</h2>`;
		fragment.appendChild(sectionHeader);
		
		if (!section.chapters || section.chapters.length === 0) {
			const noChaptersMessage = document.createElement('p');
			noChaptersMessage.className = 'px-8 py-6 text-base-content/60';
			noChaptersMessage.textContent = 'This section has no chapters yet.';
			fragment.appendChild(noChaptersMessage);
			continue;
		}
		
		for (const chapter of section.chapters) {
			console.log(`[renderManuscript] Processing chapter "${chapter.title}" (ID: ${chapter.id})`);
			const chapterWrapper = document.createElement('div');
			chapterWrapper.id = `chapter-scroll-target-${chapter.id}`;
			chapterWrapper.className = 'manuscript-chapter-item px-8 py-6';
			chapterWrapper.dataset.chapterId = chapter.id;
			
			const titleInput = document.createElement('input');
			titleInput.type = 'text';
			titleInput.value = chapter.title;
			titleInput.className = 'text-2xl font-bold w-full bg-transparent border-0 p-0 focus:ring-0 focus:border-b-2 focus:border-indigo-500 mb-4';
			titleInput.placeholder = 'Chapter Title';
			
			const debouncedTitleSave = debounce(async (value) => {
				console.log(`[SAVE] Debounced title save triggered for chapter ${chapter.id}.`);
				try {
					await window.api.updateChapterField({ chapterId: chapter.id, field: 'title', value });
				} catch (error) {
					console.error(`[SAVE] Error saving title for chapter ${chapter.id}:`, error);
					window.showAlert('Could not save title changes.');
				}
			}, 1500); // 1.5 second delay for title
			titleInput.addEventListener('input', () => debouncedTitleSave(titleInput.value));
			
			const layoutGrid = document.createElement('div');
			layoutGrid.className = 'grid grid-cols-2 gap-6';
			
			const sourceCol = document.createElement('div');
			sourceCol.className = 'col-span-1 prose prose-sm dark:prose-invert max-w-none bg-base-200 p-4 rounded-lg';
			sourceCol.innerHTML = `<h3 class="!mt-0 text-sm font-semibold uppercase tracking-wider text-base-content/70 border-b pb-1 mb-2">Source (<span class="js-source-word-count">${chapter.source_word_count.toLocaleString()} words</span>)</h3>`;
			const sourceContentContainer = document.createElement('div');
			sourceContentContainer.className = 'source-content-readonly';
			
			const processedSourceHtml = processSourceContentForDisplay(chapter.source_content || '');
			sourceContentContainer.innerHTML = processedSourceHtml;
			sourceCol.appendChild(sourceContentContainer);
			
			const targetCol = document.createElement('div');
			targetCol.className = 'col-span-1 prose prose-sm dark:prose-invert max-w-none p-4';
			targetCol.innerHTML = `<h3 class="!mt-0 text-sm font-semibold uppercase tracking-wider text-base-content/70 border-b pb-1 mb-2">Target (<span class="js-target-word-count">${chapter.target_word_count.toLocaleString()} words</span>)</h3>`;
			const targetContentMount = document.createElement('div');
			targetContentMount.className = 'js-target-content-editable';
			targetCol.appendChild(targetContentMount);
			
			const codexTagsHtml = chapter.linked_codex.map(entry =>
				chapterCodexTagTemplate
					.replace(/{{ENTRY_ID}}/g, entry.id)
					.replace(/{{ENTRY_TITLE}}/g, entry.title)
					.replace(/{{CHAPTER_ID}}/g, chapter.id)
			).join('');
			const codexSection = document.createElement('div');
			codexSection.className = `js-codex-links-wrapper mt-4 pt-4 border-t border-base-300 ${chapter.linked_codex.length === 0 ? 'hidden' : ''}`;
			codexSection.innerHTML = `
                <h4 class="text-xs uppercase tracking-wider font-bold mb-2">Linked Entries</h4>
                <div class="js-codex-tags-container flex flex-wrap gap-1">${codexTagsHtml}</div>`;
			
			layoutGrid.appendChild(sourceCol);
			layoutGrid.appendChild(targetCol);
			
			chapterWrapper.appendChild(titleInput);
			chapterWrapper.appendChild(layoutGrid);
			chapterWrapper.appendChild(codexSection);
			
			const hr = document.createElement('hr');
			hr.className = 'mt-6';
			chapterWrapper.appendChild(hr);
			
			fragment.appendChild(chapterWrapper);
			
			let initialTargetContent = chapter.target_content;
			if (!initialTargetContent && chapter.source_content) {
				const tempDiv = document.createElement('div');
				tempDiv.innerHTML = processedSourceHtml;
				const markers = tempDiv.querySelectorAll('.note-wrapper');
				
				let skeletonHtml = '';
				markers.forEach(markerNode => {
					skeletonHtml += markerNode.outerHTML;
					skeletonHtml += '<p></p>';
				});
				initialTargetContent = skeletonHtml;
			}
			
			const targetContentView = createEditorView(targetContentMount, initialTargetContent, true, chapter.id, 'target_content');
			
			chapterEditorViews.set(chapter.id.toString(), {
				targetContentView
			});
		}
	}
	
	container.innerHTML = '';
	container.appendChild(fragment);
	console.log('[renderManuscript] Finished manuscript render.');
	console.timeEnd('renderManuscript');
}


/**
 * Sets up the intersection observer to track the active chapter during scrolling.
 */
function setupIntersectionObserver() {
	console.log('[setupIntersectionObserver] Setting up...');
	const container = document.getElementById('js-manuscript-container');
	const navDropdown = document.getElementById('js-chapter-nav-dropdown');
	
	const observer = new IntersectionObserver((entries) => {
		if (isScrollingProgrammatically) return;
		console.log('[IntersectionObserver] Fired. Entries count:', entries.length);
		
		entries.forEach(entry => {
			if (entry.isIntersecting) {
				const chapterId = entry.target.dataset.chapterId;
				if (chapterId && chapterId !== activeChapterId) {
					console.log(`[IntersectionObserver] Chapter ${chapterId} is now active.`);
					activeChapterId = chapterId;
					navDropdown.value = chapterId;
				}
			}
		});
	}, {
		root: container,
		rootMargin: '-40% 0px -60% 0px',
		threshold: 0,
	});
	
	container.querySelectorAll('.manuscript-chapter-item').forEach(el => observer.observe(el));
	console.log('[setupIntersectionObserver] Observer is now watching chapter items.');
}

/**
 * Populates and configures the navigation dropdown.
 * @param {object} novelData - The full novel data.
 */
function populateNavDropdown(novelData) {
	console.log('[populateNavDropdown] Populating chapter navigation dropdown.');
	const navDropdown = document.getElementById('js-chapter-nav-dropdown');
	navDropdown.innerHTML = '';
	
	novelData.sections.forEach(section => {
		const optgroup = document.createElement('optgroup');
		optgroup.label = `${section.section_order}. ${section.title}`;
		if (section.chapters && section.chapters.length > 0) {
			section.chapters.forEach(chapter => {
				const option = new Option(`${chapter.chapter_order}. ${chapter.title}`, chapter.id);
				optgroup.appendChild(option);
			});
		}
		navDropdown.appendChild(optgroup);
	});
	
	navDropdown.addEventListener('change', () => {
		console.log('[NavDropdown] Change event detected, scrolling to chapter:', navDropdown.value);
		scrollToChapter(navDropdown.value);
	});
}

/**
 * Scrolls the manuscript to a specific chapter.
 * @param {string} chapterId - The ID of the chapter to scroll to.
 */
function scrollToChapter(chapterId) {
	console.log(`[scrollToChapter] Attempting to scroll to chapter ${chapterId}`);
	const target = document.getElementById(`chapter-scroll-target-${chapterId}`);
	const container = document.getElementById('js-manuscript-container');
	
	if (target && container) {
		isScrollingProgrammatically = true;
		console.log('[scrollToChapter] Starting programmatic scroll.');
		
		const containerRect = container.getBoundingClientRect();
		const targetRect = target.getBoundingClientRect();
		
		const offsetTop = targetRect.top - containerRect.top;
		const scrollPosition = container.scrollTop + offsetTop - 100;
		
		container.scrollTo({
			top: scrollPosition,
			behavior: 'smooth'
		});
		
		if (chapterId !== activeChapterId) {
			activeChapterId = chapterId;
		}
		setTimeout(() => {
			console.log('[scrollToChapter] Ending programmatic scroll flag.');
			isScrollingProgrammatically = false;
		}, 1000); // Increased timeout to ensure smooth scroll completes
	} else {
		console.warn(`[scrollToChapter] Could not find target element for chapter ${chapterId}`);
	}
}

/**
 * Sets up the event listener for unlinking codex entries.
 */
function setupCodexUnlinking() {
	console.log('[setupCodexUnlinking] Setting up listener...');
	const container = document.getElementById('js-manuscript-container');
	container.addEventListener('click', async (event) => {
		const removeBtn = event.target.closest('.js-remove-codex-link');
		if (!removeBtn) return;
		console.log('[CodexUnlink] Remove button clicked.');
		
		const tag = removeBtn.closest('.js-codex-tag');
		const chapterId = removeBtn.dataset.chapterId;
		const codexEntryId = removeBtn.dataset.entryId;
		const entryTitle = tag.querySelector('.js-codex-tag-title').textContent;
		
		if (!confirm(`Are you sure you want to unlink "${entryTitle}" from this chapter?`)) {
			console.log('[CodexUnlink] Unlink cancelled by user.');
			return;
		}
		
		try {
			const data = await window.api.detachCodexFromChapter(chapterId, codexEntryId);
			if (!data.success) throw new Error(data.message || 'Failed to unlink codex entry.');
			console.log('[CodexUnlink] Unlink successful.');
			
			const tagContainer = tag.parentElement;
			tag.remove();
			
			if (tagContainer && tagContainer.children.length === 0) {
				const tagsWrapper = tagContainer.closest('.js-codex-links-wrapper');
				if (tagsWrapper) tagsWrapper.classList.add('hidden');
			}
		} catch (error) {
			console.error('[CodexUnlink] Error unlinking codex entry:', error);
			window.showAlert(error.message);
		}
	});
}

/**
 * Sets up the note editor modal for creating and editing notes.
 */
function setupNoteEditorModal() {
	console.log('[setupNoteEditorModal] Setting up modal...');
	const modal = document.getElementById('note-editor-modal');
	const form = document.getElementById('note-editor-form');
	const closeBtn = modal.querySelector('.js-close-note-modal');
	if (!modal || !form || !closeBtn) {
		console.error('[setupNoteEditorModal] Could not find all required modal elements.');
		return;
	}
	
	form.addEventListener('submit', (event) => {
		event.preventDefault();
		console.log('[NoteEditor] Form submitted.');
		
		const view = getActiveEditor();
		if (!view) {
			console.error('[NoteEditor] No active editor view to save note to.');
			window.showAlert('Could not find an active editor to save the note. Please click inside an editor first.', 'Save Error');
			return;
		}
		
		const contentInput = document.getElementById('note-content-input');
		const posInput = document.getElementById('note-pos');
		const noteText = contentInput.value.trim();
		
		if (!noteText) {
			window.showAlert('Note cannot be empty.', 'Validation Error');
			return;
		}
		
		const pos = posInput.value ? parseInt(posInput.value, 10) : null;
		let tr;
		
		if (pos !== null && !isNaN(pos)) {
			console.log(`[NoteEditor] Updating existing note at position ${pos}.`);
			tr = view.state.tr.setNodeMarkup(pos, null, { text: noteText });
		} else {
			console.log('[NoteEditor] Creating new note.');
			const { $from } = view.state.selection;
			const noteNode = schema.nodes.note.create({ text: noteText });
			tr = view.state.tr.replaceRangeWith($from.start(), $from.end(), noteNode);
		}
		
		view.dispatch(tr);
		view.focus();
		modal.close();
		form.reset();
	});
	
	closeBtn.addEventListener('click', () => {
		console.log('[NoteEditor] Modal closed via button.');
		modal.close();
		form.reset();
	});
}

/**
 * Sets up the event listener for the "Translate Block" button in the source panel.
 */
function setupTranslateBlockAction() {
	console.log('[setupTranslateBlockAction] Setting up listener...');
	const container = document.getElementById('js-manuscript-container');
	container.addEventListener('click', (event) => {
		const translateBtn = event.target.closest('.js-translate-block-btn');
		if (!translateBtn) return;
		console.log('[TranslateBlock] Button clicked.');
		
		event.preventDefault();
		event.stopPropagation();
		
		const marker = translateBtn.closest('[data-block-number]');
		const sourceContainer = marker.closest('.source-content-readonly');
		const blockNumber = parseInt(marker.dataset.blockNumber, 10);
		console.log(`[TranslateBlock] Found block number: ${blockNumber}`);
		
		if (!sourceContainer || isNaN(blockNumber)) {
			console.error('[TranslateBlock] Could not find source container or block number for translation.');
			return;
		}
		
		const allMarkers = Array.from(sourceContainer.querySelectorAll('[data-block-number]'));
		const currentMarkerIndex = allMarkers.findIndex(m => parseInt(m.dataset.blockNumber, 10) === blockNumber);
		if (currentMarkerIndex === -1) return;
		
		const startNode = allMarkers[currentMarkerIndex];
		const endNode = (currentMarkerIndex + 1 < allMarkers.length) ? allMarkers[currentMarkerIndex + 1] : null;
		
		const range = document.createRange();
		range.setStartAfter(startNode);
		
		if (endNode) {
			range.setEndBefore(endNode);
		} else {
			range.selectNodeContents(sourceContainer);
			range.setStartAfter(startNode);
		}
		console.log('[TranslateBlock] Created text range for selection.');
		
		const selection = window.getSelection();
		selection.removeAllRanges();
		selection.addRange(range);
		
		const toolbarTranslateBtn = document.querySelector('#top-toolbar .js-ai-action-btn[data-action="translate"]');
		if (toolbarTranslateBtn) {
			console.log('[TranslateBlock] Simulating click on top toolbar translate button.');
			setTimeout(() => {
				if (!toolbarTranslateBtn.disabled) {
					toolbarTranslateBtn.click();
				} else {
					console.warn('[TranslateBlock] Translate button was disabled after block selection, likely empty block.');
				}
			}, 50);
		}
	});
}

// Main Initialization
document.addEventListener('DOMContentLoaded', async () => {
	console.log('[DOM] DOMContentLoaded event fired. Starting initialization.');
	
	window.showAlert = function(message, title = 'Error') {
		const modal = document.getElementById('alert-modal');
		if (modal) {
			const modalTitle = modal.querySelector('#alert-modal-title');
			const modalContent = modal.querySelector('#alert-modal-content');
			if (modalTitle) modalTitle.textContent = title;
			if (modalContent) modalContent.textContent = message;
			modal.showModal();
		} else {
			alert(message);
		}
	};
	
	const params = new URLSearchParams(window.location.search);
	const novelId = params.get('novelId');
	const initialChapterId = params.get('chapterId');
	console.log(`[Init] Novel ID: ${novelId}, Initial Chapter ID: ${initialChapterId}`);
	
	if (!novelId) {
		document.body.innerHTML = '<p class="text-error p-8">Error: Project ID is missing.</p>';
		return;
	}
	
	document.body.dataset.novelId = novelId;
	
	try {
		console.log('[Init] Fetching full manuscript data...');
		const novelData = await window.api.getFullManuscript(novelId);
		if (!novelData || !novelData.title) {
			throw new Error('Failed to load project data from the database.');
		}
		console.log('[Init] Manuscript data loaded successfully.');
		
		document.title = `Translating: ${novelData.title}`;
		document.getElementById('js-novel-title').textContent = novelData.title;
		
		const manuscriptContainer = document.getElementById('js-manuscript-container');
		
		if (!novelData.sections || novelData.sections.length === 0) {
			manuscriptContainer.innerHTML = `<div class="p-8 text-center text-base-content/70">
				<p>This project has no content yet.</p>
				<p class="text-sm mt-2">You can import a document from the dashboard to get started.</p>
			</div>`;
			document.getElementById('js-chapter-nav-dropdown').disabled = true;
			console.log('[Init] No sections found. Displaying empty message.');
			return;
		}
		
		await renderManuscript(manuscriptContainer, novelData);
		populateNavDropdown(novelData);
		
		console.log('[Init] Setting up UI components...');
		setupTopToolbar({
			isChapterEditor: true,
			getActiveChapterId: () => activeChapterId,
			getChapterViews: (chapterId) => chapterEditorViews.get(chapterId.toString()),
		});
		setupPromptEditor();
		setupIntersectionObserver();
		setupCodexUnlinking();
		setupNoteEditorModal();
		setupTranslateBlockAction(); // MODIFIED: Added call to setup the new feature.
		console.log('[Init] UI components setup complete.');
		
		const throttledUpdateToolbar = debounce(async (view) => {
			console.log('[SelectionChange] Debounced event fired. Updating toolbar state.');
			updateToolbarState(getActiveEditor());
		}, 500);
		
		document.addEventListener('selectionchange', throttledUpdateToolbar);
		console.log('[Init] "selectionchange" listener attached.');
		
		const chapterToLoad = initialChapterId || novelData.sections[0]?.chapters[0]?.id;
		if (chapterToLoad) {
			console.log(`[Init] Initial chapter to load: ${chapterToLoad}`);
			document.getElementById('js-chapter-nav-dropdown').value = chapterToLoad;
			setTimeout(() => scrollToChapter(chapterToLoad), 100);
		} else {
			console.log('[Init] No specific initial chapter to load.');
		}
		
		document.body.addEventListener('click', (event) => {
			const openBtn = event.target.closest('.js-open-codex-entry');
			if (openBtn) {
				console.log(`[Codex] Opening codex entry: ${openBtn.dataset.entryId}`);
				window.api.openCodexEditor(openBtn.dataset.entryId);
			}
		});
		
		if (window.api && typeof window.api.onManuscriptScrollToChapter === 'function') {
			window.api.onManuscriptScrollToChapter((event, chapterId) => {
				console.log(`[IPC] Received onManuscriptScrollToChapter event for chapter: ${chapterId}`);
				if (chapterId) {
					scrollToChapter(chapterId);
					const navDropdown = document.getElementById('js-chapter-nav-dropdown');
					if (navDropdown) {
						navDropdown.value = chapterId;
					}
				}
			});
			console.log('[Init] IPC listener for scrolling is ready.');
		}
		console.log('[Init] All initialization tasks are complete.');
		
	} catch (error) {
		console.error('Failed to load manuscript data:', error);
		document.body.innerHTML = `<p class="text-error p-8">Error: Could not load manuscript. ${error.message}</p>`;
	}
});
