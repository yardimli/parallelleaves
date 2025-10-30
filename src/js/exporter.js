import { t } from './i18n.js';

/**
 * Handles the entire process of exporting a novel to a DOCX file.
 * @param {number} novelId - The ID of the novel to export.
 */
export async function exportNovel(novelId) {
	try {
		// 1. Fetch all necessary data from the main process.
		const result = await window.api.getNovelForExport(novelId);
		if (!result.success) {
			throw new Error(result.message);
		}
		const novel = result.data;
		
		// 2. Construct a single HTML string from the novel data.
		let htmlContent = `<h1>${novel.title}</h1>`;
		if (novel.author) {
			htmlContent += `<p><em>by ${novel.author}</em></p>`;
		}
		
		novel.chapters.forEach(chapter => {
			// Add Chapter breaks using a page break and heading.
			htmlContent += `<br pageBreakBefore="true" /><h3>${chapter.title}</h3>`;
			
			const content = chapter.target_content || '<p><em>(No content)</em></p>';
			// Clean markers from the final output.
			const cleanedContent = content.replace(/(\[\[#\d+\]\])|(\{\{#\d+\}\})/g, '');
			htmlContent += cleanedContent;
		});
		// MODIFICATION END
		
		// 3. Send the constructed HTML, target language, and localized dialog strings to the main process.
		const exportResult = await window.api.exportNovelToDocx({
			title: novel.title,
			htmlContent: htmlContent,
			targetLanguage: novel.target_language,
			dialogStrings: {
				title: t('export.exportDialogTitle'),
				message: t('export.exportDialogMessage', { title: novel.title }),
				detail: t('export.exportDialogDetail'), // {filePath} is a placeholder for the main process
				openFolder: t('export.exportDialogOpenFolder'),
				ok: t('export.exportDialogOK'),
			},
		});
		
		if (!exportResult.success) {
			if (exportResult.message !== 'Export cancelled by user.') {
				throw new Error(exportResult.message);
			}
		}
		
	} catch (error) {
		console.error('Export failed:', error);
		window.showAlert(
			t('export.exportErrorMessage', { message: error.message }),
			t('export.exportErrorTitle')
		);
	}
}
