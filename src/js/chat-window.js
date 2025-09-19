import { initI18n, t, applyTranslationsTo } from './i18n.js';

let chatHistory = []; // Array of { role: 'user' | 'assistant', content: '...' }

const chatHistoryContainer = document.getElementById('js-chat-history');
const chatForm = document.getElementById('js-chat-form');
const chatInput = document.getElementById('js-chat-input');
const sendBtn = document.getElementById('js-send-btn');
const modelSelect = document.getElementById('js-llm-model-select');

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
	chatHistory.push({ role: 'user', content: messageText });
	chatInput.value = '';
	chatInput.style.height = 'auto'; // Reset height
	
	// Show loading indicator
	const loadingMessage = renderMessage('assistant', '', true);
	sendBtn.disabled = true;
	chatInput.disabled = true;
	
	try {
		// Keep only the last 4 messages (2 pairs) for context + the new one
		const contextMessages = chatHistory.slice(-5);
		
		const result = await window.api.chatSendMessage({
			model: selectedModel,
			messages: contextMessages,
		});
		
		if (result.success) {
			const aiResponse = result.data.choices[0].message.content;
			chatHistory.push({ role: 'assistant', content: aiResponse });
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
 * Populates the AI model selection dropdown.
 */
async function populateModels() {
	try {
		const result = await window.api.getModels();
		if (result.success) {
			modelSelect.innerHTML = '';
			result.models.forEach(group => {
				const optgroup = document.createElement('optgroup');
				optgroup.label = group.provider;
				group.models.forEach(model => {
					const option = new Option(`${model.name}`, model.id);
					optgroup.appendChild(option);
				});
				modelSelect.appendChild(optgroup);
			});
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
	
	populateModels();
	
	chatForm.addEventListener('submit', handleSendMessage);
	chatInput.addEventListener('input', autoResizeTextarea);
	chatInput.addEventListener('keydown', (e) => {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			chatForm.requestSubmit();
		}
	});
});
