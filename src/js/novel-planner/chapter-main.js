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

const debounceTimers = new Map();
let activeChapterId = null;
let isScrollingProgrammatically = false;
const chapterEditorViews = new Map();

/**
 * Triggers a debounced save for a specific field of a chapter.
 * @param {string} chapterId - The ID of the chapter being edited.
 * @param {string} field - The field to save ('title', 'target_content').
 * @param {string} value - The new value of the field.
 */
function triggerDebouncedSave(chapterId, field, value) {
	const key = `chapter-${chapterId}-${field}`;
	if (debounceTimers.has(key)) {
		clearTimeout(debounceTimers.get(key));
	}
	const timer = setTimeout(async () => {
		try {
			await window.api.updateChapterField({ chapterId, field, value });
		} catch (error) {
			console.error(`Error saving ${field} for chapter ${chapterId}:`, error);
			// MODIFIED: Replaced native alert with custom modal.
			window.showAlert(`Could not save ${field} changes.`);
		}
		debounceTimers.delete(key);
	}, 2000);
}

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
	const editorPlugin = new Plugin({
		props: {
			editable: () => isEditable,
			handleDOMEvents: {
				focus(view) {
					// We can now set any focused editor as the active one.
					setActiveEditor(view);
					updateToolbarState(view);
					const chapterItem = view.dom.closest('.manuscript-chapter-item');
					if (chapterItem) {
						const currentChapterId = chapterItem.dataset.chapterId;
						if (currentChapterId && currentChapterId !== activeChapterId) {
							activeChapterId = currentChapterId;
							document.getElementById('js-chapter-nav-dropdown').value = currentChapterId;
						}
					}
				},
				blur(view, event) {
					const relatedTarget = event.relatedTarget;
					if (!relatedTarget || (!relatedTarget.closest('#top-toolbar') && !relatedTarget.closest('#note-editor-modal'))) {
						setActiveEditor(null);
						updateToolbarState(null);
					}
				},
			},
		},
	});
	
	const doc = DOMParser.fromSchema(schema).parse(document.createRange().createContextualFragment(initialHtml || ''));
	
	return new EditorView(mount, {
		state: EditorState.create({
			doc: doc,
			plugins: [history(), keymap({ 'Mod-z': undo, 'Mod-y': redo }), keymap(baseKeymap), editorPlugin],
		}),
		nodeViews: {
			note(node, view, getPos) { return new NoteNodeView(node, view, getPos); }
		},
		dispatchTransaction(transaction) {
			const newState = this.state.apply(transaction);
			this.updateState(newState);
			
			if (isEditable && transaction.docChanged) {
				const serializer = DOMSerializer.fromSchema(this.state.schema);
				const fragmentContent = serializer.serializeFragment(this.state.doc.content);
				const tempDiv = document.createElement('div');
				tempDiv.appendChild(fragmentContent);
				triggerDebouncedSave(chapterId, saveField, tempDiv.innerHTML);
				
				if (saveField === 'target_content') {
					const wordCount = this.state.doc.textContent.trim().split(/\s+/).filter(Boolean).length;
					const wordCountEl = mount.closest('.manuscript-chapter-item').querySelector('.js-target-word-count');
					if(wordCountEl) {
						wordCountEl.textContent = `${wordCount.toLocaleString()} words`;
					}
				}
			}
			
			if (transaction.selectionSet || transaction.docChanged) {
				if (this.hasFocus()) {
					updateToolbarState(this);
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
	if (!sourceHtml) return '';
	// This regex finds all instances of {{TranslationBlock-NUMBER}} and replaces them.
	return sourceHtml.replace(/{{TranslationBlock-(\d+)}}/g, (match, blockNumber) => {
		const stylingClasses = 'note-wrapper not-prose p-1 my-1 border-l-4 border-yellow-400 bg-yellow-50 dark:bg-yellow-900/20 dark:border-yellow-600 rounded-r-md';
		return `<div class="${stylingClasses}"><p>translation block #${blockNumber}</p></div>`;
	});
}

/**
 * Renders the entire manuscript into the container.
 * @param {HTMLElement} container - The manuscript container element.
 * @param {object} novelData - The full novel data.
 */
async function renderManuscript(container, novelData) {
	const fragment = document.createDocumentFragment();
	const chapterCodexTagTemplate = await window.api.getTemplate('chapter/chapter-codex-tag');
	
	for (const section of novelData.sections) {
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
			const chapterWrapper = document.createElement('div');
			chapterWrapper.id = `chapter-scroll-target-${chapter.id}`;
			chapterWrapper.className = 'manuscript-chapter-item px-8 py-6';
			chapterWrapper.dataset.chapterId = chapter.id;
			
			const titleInput = document.createElement('input');
			titleInput.type = 'text';
			titleInput.value = chapter.title;
			titleInput.className = 'text-2xl font-bold w-full bg-transparent border-0 p-0 focus:ring-0 focus:border-b-2 focus:border-indigo-500 mb-4';
			titleInput.placeholder = 'Chapter Title';
			titleInput.addEventListener('input', () => triggerDebouncedSave(chapter.id, 'title', titleInput.value));
			
			const layoutGrid = document.createElement('div');
			layoutGrid.className = 'grid grid-cols-2 gap-6';
			
			const sourceCol = document.createElement('div');
			sourceCol.className = 'col-span-1 prose prose-sm dark:prose-invert max-w-none bg-base-200 p-4 rounded-lg';
			sourceCol.innerHTML = `<h3 class="!mt-0 text-sm font-semibold uppercase tracking-wider text-base-content/70 border-b pb-1 mb-2">Source (<span class="js-source-word-count">${chapter.source_word_count.toLocaleString()} words</span>)</h3>`;
			const sourceContentContainer = document.createElement('div');
			sourceContentContainer.className = 'source-content-readonly'; // Styling is now on the parent `sourceCol`.
			
			const processedSourceHtml = processSourceContentForDisplay(chapter.source_content || '');
			sourceContentContainer.innerHTML = processedSourceHtml;
			sourceCol.appendChild(sourceContentContainer);
			
			const targetCol = document.createElement('div');
			targetCol.className = 'col-span-1 prose prose-sm dark:prose-invert max-w-none p-4';
			targetCol.innerHTML = `<h3 class="!mt-0 text-sm font-semibold uppercase tracking-wider text-base-content/70 border-b pb-1 mb-2">Target (<span class="js-target-word-count">${chapter.target_word_count.toLocaleString()} words</span>)</h3>`;
			const targetContentMount = document.createElement('div');
			targetContentMount.className = 'js-target-content-editable'; // Styling is now on the parent `targetCol`.
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
}


/**
 * Sets up the intersection observer to track the active chapter during scrolling.
 */
function setupIntersectionObserver() {
	const container = document.getElementById('js-manuscript-container');
	const navDropdown = document.getElementById('js-chapter-nav-dropdown');
	
	const observer = new IntersectionObserver((entries) => {
		if (isScrollingProgrammatically) return;
		
		entries.forEach(entry => {
			if (entry.isIntersecting) {
				const chapterId = entry.target.dataset.chapterId;
				if (chapterId && chapterId !== activeChapterId) {
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
}

/**
 * Populates and configures the navigation dropdown.
 * @param {object} novelData - The full novel data.
 */
function populateNavDropdown(novelData) {
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
		scrollToChapter(navDropdown.value);
	});
}

/**
 * Scrolls the manuscript to a specific chapter.
 * @param {string} chapterId - The ID of the chapter to scroll to.
 */
function scrollToChapter(chapterId) {
	const target = document.getElementById(`chapter-scroll-target-${chapterId}`);
	const container = document.getElementById('js-manuscript-container');
	
	if (target && container) {
		isScrollingProgrammatically = true;
		
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
		setTimeout(() => { isScrollingProgrammatically = false; }, 1000);
	}
}

/**
 * Sets up the event listener for unlinking codex entries.
 */
function setupCodexUnlinking() {
	const container = document.getElementById('js-manuscript-container');
	container.addEventListener('click', async (event) => {
		const removeBtn = event.target.closest('.js-remove-codex-link');
		if (!removeBtn) return;
		
		const tag = removeBtn.closest('.js-codex-tag');
		const chapterId = removeBtn.dataset.chapterId;
		const codexEntryId = removeBtn.dataset.entryId;
		const entryTitle = tag.querySelector('.js-codex-tag-title').textContent;
		
		if (!confirm(`Are you sure you want to unlink "${entryTitle}" from this chapter?`)) {
			return;
		}
		
		try {
			const data = await window.api.detachCodexFromChapter(chapterId, codexEntryId);
			if (!data.success) throw new Error(data.message || 'Failed to unlink codex entry.');
			
			const tagContainer = tag.parentElement;
			tag.remove();
			
			if (tagContainer && tagContainer.children.length === 0) {
				const tagsWrapper = tagContainer.closest('.js-codex-links-wrapper');
				if (tagsWrapper) tagsWrapper.classList.add('hidden');
			}
		} catch (error) {
			console.error('Error unlinking codex entry:', error);
			// MODIFIED: Replaced native alert with custom modal.
			window.showAlert(error.message);
		}
	});
}

/**
 * Sets up the note editor modal for creating and editing notes.
 */
function setupNoteEditorModal() {
	const modal = document.getElementById('note-editor-modal');
	const form = document.getElementById('note-editor-form');
	const closeBtn = modal.querySelector('.js-close-note-modal');
	if (!modal || !form || !closeBtn) return;
	
	form.addEventListener('submit', (event) => {
		event.preventDefault();
		
		const view = getActiveEditor();
		
		if (!view) {
			console.error('No active editor view to save note to.');
			// MODIFIED: Replaced native alert with custom modal.
			window.showAlert('Could not find an active editor to save the note. Please click inside an editor first.', 'Save Error');
			return;
		}
		
		const contentInput = document.getElementById('note-content-input');
		const posInput = document.getElementById('note-pos');
		const noteText = contentInput.value.trim();
		
		if (!noteText) {
			// MODIFIED: Replaced native alert with custom modal.
			window.showAlert('Note cannot be empty.', 'Validation Error');
			return;
		}
		
		const pos = posInput.value ? parseInt(posInput.value, 10) : null;
		let tr;
		
		if (pos !== null && !isNaN(pos)) {
			tr = view.state.tr.setNodeMarkup(pos, null, { text: noteText });
		} else {
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
		modal.close();
		form.reset();
	});
}

// Main Initialization
document.addEventListener('DOMContentLoaded', async () => {
	// ADDED SECTION START
	/**
	 * Displays a custom modal alert to prevent focus issues with native alerts.
	 * @param {string} message - The message to display.
	 * @param {string} [title='Error'] - The title for the alert modal.
	 */
	window.showAlert = function(message, title = 'Error') {
		const modal = document.getElementById('alert-modal');
		if (modal) {
			const modalTitle = modal.querySelector('#alert-modal-title');
			const modalContent = modal.querySelector('#alert-modal-content');
			if (modalTitle) modalTitle.textContent = title;
			if (modalContent) modalContent.textContent = message;
			modal.showModal();
		} else {
			// Fallback for pages without the modal
			alert(message);
		}
	};
	// ADDED SECTION END
	
	const params = new URLSearchParams(window.location.search);
	const novelId = params.get('novelId');
	const initialChapterId = params.get('chapterId');
	
	if (!novelId) {
		document.body.innerHTML = '<p class="text-error p-8">Error: Project ID is missing.</p>';
		return;
	}
	
	document.body.dataset.novelId = novelId;
	
	try {
		const novelData = await window.api.getFullManuscript(novelId);
		if (!novelData || !novelData.title) {
			throw new Error('Failed to load project data from the database.');
		}
		
		document.title = `Translating: ${novelData.title}`;
		document.getElementById('js-novel-title').textContent = novelData.title;
		
		const manuscriptContainer = document.getElementById('js-manuscript-container');
		
		if (!novelData.sections || novelData.sections.length === 0) {
			manuscriptContainer.innerHTML = `<div class="p-8 text-center text-base-content/70">
				<p>This project has no content yet.</p>
				<p class="text-sm mt-2">You can import a document from the dashboard to get started.</p>
			</div>`;
			document.getElementById('js-chapter-nav-dropdown').disabled = true;
			return;
		}
		
		await renderManuscript(manuscriptContainer, novelData);
		populateNavDropdown(novelData);
		
		setupTopToolbar({
			isChapterEditor: true,
			getActiveChapterId: () => activeChapterId,
			getChapterViews: (chapterId) => chapterEditorViews.get(chapterId.toString()), // MODIFIED: ensure chapterId is string
		});
		setupPromptEditor();
		setupIntersectionObserver();
		setupCodexUnlinking();
		setupNoteEditorModal();
		
		// NEW: Listen for any selection change to update toolbar state for source panel selections.
		document.addEventListener('selectionchange', () => {
			updateToolbarState(getActiveEditor());
		});
		
		const chapterToLoad = initialChapterId || novelData.sections[0]?.chapters[0]?.id;
		if (chapterToLoad) {
			document.getElementById('js-chapter-nav-dropdown').value = chapterToLoad;
			setTimeout(() => scrollToChapter(chapterToLoad), 100);
		}
		
		document.body.addEventListener('click', (event) => {
			const openBtn = event.target.closest('.js-open-codex-entry');
			if (openBtn) {
				window.api.openCodexEditor(openBtn.dataset.entryId);
			}
		});
		
		if (window.api && typeof window.api.onManuscriptScrollToChapter === 'function') {
			window.api.onManuscriptScrollToChapter((event, chapterId) => {
				if (chapterId) {
					scrollToChapter(chapterId);
					const navDropdown = document.getElementById('js-chapter-nav-dropdown');
					if (navDropdown) {
						navDropdown.value = chapterId;
					}
				}
			});
		}
		
	} catch (error) {
		console.error('Failed to load manuscript data:', error);
		document.body.innerHTML = `<p class="text-error p-8">Error: Could not load manuscript. ${error.message}</p>`;
	}
});
