// MODIFIED: This file is completely rewritten to be the entry point for the new full-manuscript editor.
import { setupTopToolbar } from './toolbar.js';
import { setupPromptEditor } from '../prompt-editor.js';
import { EditorState, Plugin } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { DOMParser, DOMSerializer } from 'prosemirror-model';
import { history, undo, redo } from 'prosemirror-history';
import { keymap } from 'prosemirror-keymap';
import { baseKeymap } from 'prosemirror-commands';
// MODIFIED: Import NoteNodeView, getActiveEditor and the full schema.
import { schema, NoteNodeView, getActiveEditor, setActiveEditor } from './content-editor.js';
import { updateToolbarState } from './toolbar.js';

const debounceTimers = new Map();
let activeChapterId = null;
let isScrollingProgrammatically = false;
const chapterEditorViews = new Map(); // NEW: Will store { summaryView, contentView } for each chapterId

/**
 * Triggers a debounced save for a specific field of a chapter.
 * @param {string} chapterId - The ID of the chapter being edited.
 * @param {string} field - The field to save ('title', 'content', 'summary').
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
			alert(`Error: Could not save ${field} changes.`);
		}
		debounceTimers.delete(key);
	}, 2000);
}

/**
 * Renders the entire manuscript into the container.
 * @param {HTMLElement} container - The manuscript container element.
 * @param {object} novelData - The full novel data.
 */
async function renderManuscript(container, novelData) {
	const fragment = document.createDocumentFragment();
	let totalWordCount = 0;
	
	const chapterCodexTagTemplate = await window.api.getTemplate('chapter/chapter-codex-tag'); // NEW: Get template for tags
	
	novelData.sections.forEach(section => {
		const sectionHeader = document.createElement('div');
		sectionHeader.className = 'px-8 py-6 sticky top-0 bg-base-100/90 backdrop-blur-sm z-10 border-b border-base-300';
		sectionHeader.innerHTML = `<h2 class="text-3xl font-bold text-indigo-500">${section.section_order}. ${section.title}</h2>`;
		fragment.appendChild(sectionHeader);
		
		section.chapters.forEach(chapter => {
			totalWordCount += chapter.word_count || 0;
			
			const chapterWrapper = document.createElement('div');
			chapterWrapper.id = `chapter-scroll-target-${chapter.id}`;
			chapterWrapper.className = 'manuscript-chapter-item prose prose-sm dark:prose-invert max-w-none px-8 py-6';
			chapterWrapper.dataset.chapterId = chapter.id;
			
			const chapterHeader = `<p class="text-base-content/50 font-semibold">Chapter ${chapter.chapter_order} &ndash; ${chapter.word_count.toLocaleString()} words</p>`;
			const titleInput = document.createElement('input');
			titleInput.type = 'text';
			titleInput.value = chapter.title;
			titleInput.className = 'js-chapter-title-input text-2xl font-bold w-full bg-transparent border-0 p-0 focus:ring-0 focus:border-b-2 focus:border-indigo-500 flex-shrink-0 not-prose';
			titleInput.placeholder = 'Chapter Title';
			
			const layoutContainer = document.createElement('div');
			layoutContainer.className = 'not-prose mt-6 flex flex-col md:flex-row gap-8';
			
			const mainContentColumn = document.createElement('div');
			mainContentColumn.className = 'w-full md:w-3/4';
			
			const contentEditorMount = document.createElement('div');
			contentEditorMount.className = 'js-content-editable mt-2';
			contentEditorMount.dataset.name = 'content';
			mainContentColumn.appendChild(contentEditorMount);
			
			const metadataColumn = document.createElement('div');
			metadataColumn.className = 'w-full md:w-1/4 flex flex-col space-y-4';
			
			const summaryHeader = '<div><h3 class="text-xs uppercase tracking-wider font-bold border-b border-base-300 pb-1 mb-2">Summary</h3></div>';
			const summaryEditorMount = document.createElement('div');
			summaryEditorMount.className = 'js-summary-editable relative';
			summaryEditorMount.dataset.name = 'summary';
			summaryEditorMount.innerHTML = `
                <div class="js-summary-spinner absolute inset-0 bg-base-100/80 backdrop-blur-sm flex items-center justify-center z-10 hidden">
                    <div class="text-center">
                        <span class="loading loading-spinner loading-lg"></span>
                        <p class="mt-2 text-sm">AI is summarizing...</p>
                    </div>
                </div>`;
			
			const codexTagsHtml = chapter.linked_codex.map(entry => {
				return chapterCodexTagTemplate
					.replace(/{{ENTRY_ID}}/g, entry.id)
					.replace(/{{ENTRY_TITLE}}/g, entry.title)
					.replace(/{{CHAPTER_ID}}/g, chapter.id);
			}).join('');
			
			const codexSection = document.createElement('div');
			codexSection.className = `js-codex-links-wrapper ${chapter.linked_codex.length === 0 ? 'hidden' : ''}`;
			codexSection.innerHTML = `
                <h4 class="text-xs uppercase tracking-wider font-bold border-b border-base-300 pb-1 mb-2">Linked Entries</h4>
                <div class="js-codex-tags-container flex flex-wrap gap-2">${codexTagsHtml}</div>
            `;
			
			metadataColumn.innerHTML = summaryHeader;
			metadataColumn.appendChild(summaryEditorMount);
			metadataColumn.appendChild(codexSection);
			
			layoutContainer.appendChild(mainContentColumn);
			layoutContainer.appendChild(metadataColumn);
			
			chapterWrapper.innerHTML = chapterHeader;
			chapterWrapper.appendChild(titleInput);
			chapterWrapper.appendChild(layoutContainer);
			chapterWrapper.appendChild(document.createElement('hr'));
			fragment.appendChild(chapterWrapper);
			
			titleInput.addEventListener('input', () => {
				triggerDebouncedSave(chapter.id, 'title', titleInput.value);
			});
			
			const editorPlugin = new Plugin({
				props: {
					handleDOMEvents: {
						focus(view) {
							setActiveEditor(view);
							updateToolbarState(view);
							const chapterItem = view.dom.closest('.manuscript-chapter-item');
							if (chapterItem) {
								const chapterId = chapterItem.dataset.chapterId;
								if (chapterId && chapterId !== activeChapterId) {
									activeChapterId = chapterId;
									const navDropdown = document.getElementById('js-chapter-nav-dropdown');
									if (navDropdown) navDropdown.value = chapterId;
								}
							}
						},
						blur(view, event) {
							const relatedTarget = event.relatedTarget;
							if (!relatedTarget || !relatedTarget.closest('#top-toolbar')) {
								setActiveEditor(null);
								updateToolbarState(null);
							}
						},
					},
				},
			});
			
			const summaryDoc = DOMParser.fromSchema(schema).parse(document.createRange().createContextualFragment(chapter.summary || ''));
			const summaryView = new EditorView(summaryEditorMount, {
				state: EditorState.create({
					doc: summaryDoc,
					plugins: [history(), keymap({ 'Mod-z': undo, 'Mod-y': redo }), keymap(baseKeymap), editorPlugin],
				}),
				dispatchTransaction(transaction) {
					const newState = this.state.apply(transaction);
					this.updateState(newState);
					if (transaction.docChanged) {
						const serializer = DOMSerializer.fromSchema(this.state.schema);
						const fragmentContent = serializer.serializeFragment(this.state.doc.content);
						const tempDiv = document.createElement('div');
						tempDiv.appendChild(fragmentContent);
						triggerDebouncedSave(chapter.id, 'summary', tempDiv.innerHTML);
					}
					if (this.hasFocus()) updateToolbarState(this);
				},
			});
			
			const contentDoc = DOMParser.fromSchema(schema).parse(document.createRange().createContextualFragment(chapter.content || ''));
			const contentView = new EditorView(contentEditorMount, {
				state: EditorState.create({
					doc: contentDoc,
					plugins: [history(), keymap({ 'Mod-z': undo, 'Mod-y': redo }), keymap(baseKeymap), editorPlugin],
				}),
				nodeViews: {
					note(node, view, getPos) { return new NoteNodeView(node, view, getPos); }
				},
				dispatchTransaction(transaction) {
					const newState = this.state.apply(transaction);
					this.updateState(newState);
					if (transaction.docChanged) {
						const serializer = DOMSerializer.fromSchema(this.state.schema);
						const fragmentContent = serializer.serializeFragment(this.state.doc.content);
						const tempDiv = document.createElement('div');
						tempDiv.appendChild(fragmentContent);
						triggerDebouncedSave(chapter.id, 'content', tempDiv.innerHTML);
						
						const wordCount = this.state.doc.textContent.trim().split(/\s+/).filter(Boolean).length;
						const headerP = chapterWrapper.querySelector('p.font-semibold');
						if (headerP) {
							headerP.innerHTML = `Chapter ${chapter.chapter_order} &ndash; ${wordCount.toLocaleString()} words`;
						}
					}
					if (transaction.selectionSet || transaction.docChanged) {
						if (this.hasFocus()) {
							updateToolbarState(this);
						}
					}
				},
			});
			
			chapterEditorViews.set(chapter.id.toString(), { summaryView, contentView });
		});
	});
	
	container.appendChild(fragment);
	document.getElementById('js-total-word-count').textContent = `Total: ${totalWordCount.toLocaleString()} words`;
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
		section.chapters.forEach(chapter => {
			const option = new Option(`${chapter.chapter_order}. ${chapter.title}`, chapter.id);
			optgroup.appendChild(option);
		});
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
			alert(error.message);
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
		
		// MODIFIED: Retrieve the target view using the stored chapter ID instead of getActiveEditor().
		const chapterIdInput = document.getElementById('note-chapter-id');
		const chapterId = chapterIdInput.value;
		const chapterViews = chapterId ? chapterEditorViews.get(chapterId) : null;
		const view = chapterViews ? chapterViews.contentView : null;
		
		if (!view) {
			console.error('No active editor view to save note to.');
			alert('Error: Could not find the target editor to save the note.'); // User-facing error
			return;
		}
		
		const contentInput = document.getElementById('note-content-input');
		const posInput = document.getElementById('note-pos');
		const noteText = contentInput.value.trim();
		
		if (!noteText) {
			alert('Note cannot be empty.');
			return;
		}
		
		const pos = posInput.value ? parseInt(posInput.value, 10) : null;
		let tr;
		
		if (pos !== null && !isNaN(pos)) {
			tr = view.state.tr.setNodeMarkup(pos, null, { text: noteText });
		} else {
			// MODIFIED: This now correctly replaces the parent block (the empty paragraph)
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
	const params = new URLSearchParams(window.location.search);
	const novelId = params.get('novelId');
	const initialChapterId = params.get('chapterId');
	
	if (!novelId) {
		document.body.innerHTML = '<p class="text-error p-8">Error: Novel ID is missing.</p>';
		return;
	}
	
	document.body.dataset.novelId = novelId;
	
	try {
		const novelData = await window.api.getFullManuscript(novelId);
		document.title = `Editing: ${novelData.title}`;
		document.getElementById('js-novel-title').textContent = novelData.title;
		
		const manuscriptContainer = document.getElementById('js-manuscript-container');
		await renderManuscript(manuscriptContainer, novelData);
		populateNavDropdown(novelData);
		
		setupTopToolbar({
			isChapterEditor: true,
			getActiveChapterId: () => activeChapterId,
			getChapterViews: (chapterId) => chapterEditorViews.get(chapterId),
		});
		setupPromptEditor();
		setupIntersectionObserver();
		setupCodexUnlinking();
		setupNoteEditorModal();
		
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
