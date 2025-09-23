import { keymap } from 'prosemirror-keymap';

/**
 * Creates a ProseMirror keymap plugin for handling application-wide shortcuts
 * that need to be communicated to the parent window.
 * @param {function} postToParent - A function to post messages to the parent window.
 * @returns {Plugin} A ProseMirror keymap plugin instance.
 */
export function createShortcutKeymap(postToParent) {
	return keymap({
		'Mod-f': () => {
			postToParent('shortcut:find');
			return true; // Mark as handled
		},
		'Mod-h': () => {
			postToParent('shortcut:find-replace');
			return true;
		},
		'Mod-1': () => {
			postToParent('shortcut:focus-source');
			return true;
		},
		'Mod-2': () => {
			postToParent('shortcut:focus-target');
			return true;
		},
		'Mod-t': (state, dispatch, view) => {
			// This shortcut directly triggers the translation action if the floating button is visible.
			// We query the DOM within the iframe to find the button.
			const floatingBtn = view.dom.ownerDocument.body.querySelector('.floating-translate-btn');
			if (floatingBtn) {
				const { selection } = state;
				if (selection.empty) {
					const { $from } = selection;
					const pos = $from.pos;
					postToParent('requestTranslation', { from: pos, to: pos });
					// Remove the button immediately for a responsive feel.
					floatingBtn.remove();
				}
			}
			return true;
		}
	});
}
