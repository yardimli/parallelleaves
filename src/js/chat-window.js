import { initI18n, t, applyTranslationsTo } from './i18n.js';
import { htmlToPlainText } from '../utils/html-processing.js';

let novelId = null;
let chatHistories = [];
let currentChat = null;

const LOCAL_STORAGE_KEY_PREFIX = 'parallel-leaves-chats-';
// New: Constants for shared AI settings
const AI_SETTINGS_KEYS = {
	MODEL: 'parallel-leaves-ai-model',
	TEMPERATURE: 'parallel-leaves-ai-temperature'
};

const chatHistoryContainer = document.getElementById('js-chat-history');
const chatForm = document.getElementById('js-chat-form');
const chatInput = document.getElementById('js-chat-input');
const sendBtn = document.getElementById('js-send-btn');
const modelSelect = document.getElementById('js-llm-model-select');
// New: Temperature slider elements
const tempSlider = document.getElementById('js-ai-temperature-slider');
const tempValue = document.getElementById('js-ai-temperature-value');

// Chat management UI elements
const chatListDropdown = document.getElementById('js-chat-list');
const newChatBtn = document.getElementById('js-new-chat-btn');
const deleteChatBtn = document.getElementById('js-delete-chat-btn');
const currentChatNameEl = document.getElementById('js-current-chat-name');
const chapterSelect = document.getElementById('js-chapter-select');

/**
 * Saves the current chat histories to local storage.
 */
function saveChats() {
	if (novelId) {
		localStorage.setItem(`${LOCAL_STORAGE_KEY_PREFIX}${novelId}`, JSON.stringify(chatHistories));
	}
}

/**
 * Loads chat histories from local storage and initializes the current chat.
 */
function loadChats() {
	if (!novelId) return;
	
	const storedChats = localStorage.getItem(`${LOCAL_STORAGE_KEY_PREFIX}${novelId}`);
	if (storedChats) {
		try {
			chatHistories = JSON.parse(storedChats);
		} catch (e) {
			console.error("Failed to parse chat histories from localStorage:", e);
			chatHistories = []; // Reset corrupted data
		}
	} else {
		chatHistories = [];
	}
	
	if (chatHistories.length === 0) {
		addNewChat(); // Start a new chat if none exist
	} else {
		selectChat(chatHistories[0].id); // Select the first chat by default
	}
	renderChatList();
}

/**
 * Generates a unique ID for a new chat.
 */
function generateChatId() {
	return `chat-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Adds a new chat conversation to the list.
 */
function addNewChat() {
	const newChatCount = chatHistories.length + 1;
	const newChatName = t('editor.chat.chatNamePlaceholder', { number: newChatCount });
	const newChat = {
		id: generateChatId(),
		name: newChatName,
		messages: [],
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
		selectedChapterId: ''
	};
	chatHistories.unshift(newChat);
	saveChats();
	selectChat(newChat.id);
}

/**
 * Selects and displays a specific chat conversation.
 * @param {string} chatId - The ID of the chat to select.
 */
function selectChat(chatId) {
	const selected = chatHistories.find(chat => chat.id === chatId);
	if (selected) {
		currentChat = selected;
		chatHistoryContainer.innerHTML = '';
		currentChat.messages.forEach(msg => renderMessage(msg.role, msg.content));
		currentChatNameEl.textContent = t('editor.chat.currentChatName', { name: currentChat.name });
		chapterSelect.value = currentChat.selectedChapterId || '';
		autoResizeTextarea();
		chatHistoryContainer.scrollTop = chatHistoryContainer.scrollHeight;
	} else {
		// Fallback if the chat isn't found, maybe it was deleted on another client
		addNewChat();
	}
	renderChatList(); // Re-render to update active state
}

/**
 * Deletes the currently active chat.
 */
function deleteCurrentChat() {
	if (!currentChat) return;
	
	const confirmDelete = confirm(t('editor.chat.chatDeletedConfirm', { chatName: currentChat.name }));
	if (confirmDelete) {
		chatHistories = chatHistories.filter(chat => chat.id !== currentChat.id);
		saveChats();
		if (chatHistories.length > 0) {
			selectChat(chatHistories[0].id);
		} else {
			addNewChat(); // If no chats left, create a new one
		}
	}
}

/**
 * Renders the list of chat histories in the dropdown.
 */
function renderChatList() {
	chatListDropdown.innerHTML = ''; // Clear existing list
	chatHistories.forEach(chat => {
		const listItem = document.createElement('li');
		const button = document.createElement('button');
		button.textContent = chat.name;
		button.className = `w-full text-left p-2 rounded ${chat.id === currentChat?.id ? 'active bg-base-300' : 'hover:bg-base-200'}`;
		button.addEventListener('click', () => selectChat(chat.id));
		listItem.appendChild(button);
		chatListDropdown.appendChild(listItem);
	});
}

/**
 * Populates the AI model selection dropdown.
 */
async function populateModels() {
	try {
		const result = await window.api.getModels();
		if (result.success) {
			modelSelect.innerHTML = '';
			result.models.forEach(group => {
				const optgroup = document.createElement('optgroup');
				optgroup.label = group.group;
				group.models.forEach(model => {
					const option = new Option(`${model.name}`, model.id);
					optgroup.appendChild(option);
				});
				modelSelect.appendChild(optgroup);
			});
			const lastModel = localStorage.getItem(AI_SETTINGS_KEYS.MODEL);
			if (lastModel && modelSelect.querySelector(`option[value="${lastModel}"]`)) {
				modelSelect.value = lastModel;
			} else if (modelSelect.options.length > 0) {
				modelSelect.selectedIndex = 0;
				localStorage.setItem(AI_SETTINGS_KEYS.MODEL, modelSelect.value);
			}
		} else {
			throw new Error(result.message);
		}
	} catch (error) {
		console.error('Failed to load models:', error);
		modelSelect.innerHTML = `<option>${t('editor.chat.errorLoadModels')}</option>`;
		modelSelect.disabled = true;
	}
}

/**
 * Populates the chapter selection dropdown with chapters from the novel.
 */
async function populateChapterSelect() {
	if (!novelId) return;
	
	chapterSelect.innerHTML = `<option value="" disabled selected>${t('editor.chat.selectChapter')}</option>`;
	chapterSelect.add(new Option(t('editor.chat.noChapter'), 'none')); // Option to deselect chapter
	
	try {
		const novelData = await window.api.getOneNovel(novelId);
		if (novelData && novelData.sections) {
			novelData.sections.forEach(section => {
				const optgroup = document.createElement('optgroup');
				optgroup.label = section.title;
				section.chapters.forEach(chapter => {
					const option = new Option(chapter.title, chapter.id);
					optgroup.appendChild(option);
				});
				chapterSelect.appendChild(optgroup);
			});
		}
		chapterSelect.value = currentChat?.selectedChapterId || 'none'; // Set the previously selected chapter or 'none'
	} catch (error) {
		console.error('Failed to load novel chapters:', error);
		chapterSelect.disabled = true;
	}
}

/**
 * Renders a message to the chat history container.
 * @param {string} role - 'user' or 'assistant'.
 * @param {string} content - The message content (can be HTML).
 * @param {boolean} isLoading - If true, shows a loading spinner for assistant messages.
 * @returns {HTMLElement} The created message element.
 */
function renderMessage(role, content, isLoading = false) {
	const messageWrapper = document.createElement('div');
	messageWrapper.className = `chat ${role === 'user' ? 'chat-end' : 'chat-start'}`;
	
	const messageBubble = document.createElement('div');
	messageBubble.className = `chat-bubble ${role === 'user' ? 'chat-bubble-primary' : ''}`;
	
	if (isLoading) {
		messageBubble.innerHTML = '<span class="loading loading-dots loading-md"></span>';
	} else {
		// A simple markdown-to-html for code blocks and bold text
		let formattedContent = content
			.replace(/</g, '&lt;').replace(/>/g, '&gt;') // Sanitize HTML
			.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
			.replace(/`([^`]+)`/g, '<code class="bg-base-300 px-1 rounded text-sm font-mono">$1</code>');
		
		messageBubble.innerHTML = formattedContent.replace(/\n/g, '<br>');
	}
	
	messageWrapper.appendChild(messageBubble);
	
	if (role === 'assistant' && !isLoading) {
		const copyBtn = document.createElement('button');
		copyBtn.className = 'btn btn-ghost btn-xs opacity-50 hover:opacity-100';
		copyBtn.innerHTML = `<i class="bi bi-clipboard"></i> ${t('editor.chat.copy')}`;
		copyBtn.onclick = () => {
			navigator.clipboard.writeText(content);
			copyBtn.innerHTML = `<i class="bi bi-check-lg"></i> ${t('editor.chat.copied')}`;
			setTimeout(() => {
				copyBtn.innerHTML = `<i class="bi bi-clipboard"></i> ${t('editor.chat.copy')}`;
			}, 2000);
		};
		const actionsDiv = document.createElement('div');
		actionsDiv.className = 'chat-footer opacity-50';
		actionsDiv.appendChild(copyBtn);
		messageWrapper.appendChild(actionsDiv);
	}
	
	chatHistoryContainer.appendChild(messageWrapper);
	chatHistoryContainer.scrollTop = chatHistoryContainer.scrollHeight;
	return messageWrapper;
}

/**
 * Handles the chat form submission.
 * @param {Event} event - The form submission event.
 */
async function handleSendMessage(event) {
	event.preventDefault();
	const messageText = chatInput.value.trim();
	if (!messageText || sendBtn.disabled) return;
	
	const selectedModel = modelSelect.value;
	if (!selectedModel) {
		alert('Please select an AI model.'); // TODO: Use a better alert
		return;
	}
	
	// Add user message to UI and history
	renderMessage('user', messageText);
	currentChat.messages.push({ role: 'user', content: messageText });
	currentChat.updatedAt = new Date().toISOString();
	saveChats();
	chatInput.value = '';
	chatInput.style.height = 'auto'; // Reset height
	
	// Show loading indicator
	const loadingMessage = renderMessage('assistant', '', true);
	sendBtn.disabled = true;
	chatInput.disabled = true;
	
	let messagesToSend = [...currentChat.messages];
	const selectedChapterId = chapterSelect.value;
	if (selectedChapterId && selectedChapterId !== 'none') {
		try {
			const novelData = await window.api.getOneNovel(novelId);
			let selectedChapter = null;
			novelData.sections.forEach(section => {
				const chapter = section.chapters.find(c => c.id === parseInt(selectedChapterId));
				if (chapter) {
					selectedChapter = chapter;
				}
			});
			
			if (selectedChapter) {
				const sourceContent = htmlToPlainText(selectedChapter.source_content || '');
				const targetContent = htmlToPlainText(selectedChapter.target_content || '');
				let chapterContext = `User is asking questions about the following chapter:\n`;
				chapterContext += `Chapter Title: ${selectedChapter.title}\n`;
				if (sourceContent) chapterContext += `Source Content:\n${sourceContent}\n`;
				if (targetContent) chapterContext += `Target Content:\n${targetContent}\n`;
				
				messagesToSend.unshift({ role: 'system', content: chapterContext });
			}
		} catch (error) {
			console.error('Failed to fetch chapter content for AI chat:', error);
			renderMessage('assistant', t('editor.chat.errorSendMessage', { message: 'Could not include chapter context.' }));
		}
	}
	
	try {
		// Keep only the last 4 messages (2 pairs) for context + the new one
		// This slice now applies *after* potentially adding chapter context
		const contextMessages = messagesToSend.slice(-5);
		
		const temperature = parseFloat(tempSlider.value);
		const result = await window.api.chatSendMessage({
			model: selectedModel,
			messages: contextMessages,
			temperature: temperature
		});
		
		if (result.success) {
			const aiResponse = result.data.choices[0].message.content;
			currentChat.messages.push({ role: 'assistant', content: aiResponse });
			currentChat.updatedAt = new Date().toISOString();
			saveChats();
			loadingMessage.remove();
			renderMessage('assistant', aiResponse);
		} else {
			throw new Error(result.error);
		}
	} catch (error) {
		console.error('Failed to send message:', error);
		loadingMessage.remove();
		renderMessage('assistant', t('editor.chat.errorSendMessage', { message: error.message }));
	} finally {
		sendBtn.disabled = false;
		chatInput.disabled = false;
		chatInput.focus();
	}
}

/**
 * Adjusts the height of the textarea based on its content.
 */
function autoResizeTextarea() {
	chatInput.style.height = 'auto';
	chatInput.style.height = (chatInput.scrollHeight) + 'px';
}

// --- Initialization ---
document.addEventListener('DOMContentLoaded', async () => {
	await initI18n();
	applyTranslationsTo(document.body);
	document.title = t('editor.chat.title');
	
	const params = new URLSearchParams(window.location.search);
	novelId = params.get('novelId');
	
	if (!novelId) {
		// Handle case where novelId is missing (e.g., chat opened directly without context)
		// Maybe close the window or show an error
		console.error('Novel ID is missing from chat window URL.');
		alert('Error: This chat window requires a project context. Please open it from the editor.');
		window.close();
		return;
	}
	
	// New: Setup AI settings controls
	const lastTemp = localStorage.getItem(AI_SETTINGS_KEYS.TEMPERATURE) || '0.7';
	tempSlider.value = lastTemp;
	tempValue.textContent = parseFloat(lastTemp).toFixed(1);
	
	tempSlider.addEventListener('input', () => {
		tempValue.textContent = parseFloat(tempSlider.value).toFixed(1);
	});
	tempSlider.addEventListener('change', () => {
		localStorage.setItem(AI_SETTINGS_KEYS.TEMPERATURE, tempSlider.value);
	});
	modelSelect.addEventListener('change', () => {
		localStorage.setItem(AI_SETTINGS_KEYS.MODEL, modelSelect.value);
	});
	
	populateModels();
	populateChapterSelect();
	loadChats();
	
	// Event listeners for chat management
	newChatBtn.addEventListener('click', addNewChat);
	deleteChatBtn.addEventListener('click', deleteCurrentChat);
	chapterSelect.addEventListener('change', () => {
		if (currentChat) {
			currentChat.selectedChapterId = chapterSelect.value === 'none' ? '' : chapterSelect.value;
			currentChat.updatedAt = new Date().toISOString();
			saveChats();
		}
	});
	
	chatForm.addEventListener('submit', handleSendMessage);
	chatInput.addEventListener('input', autoResizeTextarea);
	chatInput.addEventListener('keydown', (e) => {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			chatForm.requestSubmit();
		}
	});
});
