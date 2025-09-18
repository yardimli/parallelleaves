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
		
		novel.sections.forEach(section => {
			// Add Act/Section breaks. The `pageBreakBefore` attribute is specific to html-to-docx.
			htmlContent += `<br pageBreakBefore="true" /><h2>${section.title}</h2>`;
			section.chapters.forEach(chapter => {
				// Add Chapter breaks
				htmlContent += `<h3>${chapter.title}</h3>`;
				// Add the chapter's target content (which is already HTML)
				htmlContent += chapter.target_content || '<p><em>(No content)</em></p>';
			});
		});
		
		// 3. Send the constructed HTML to the main process for conversion and saving.
		const exportResult = await window.api.exportNovelToDocx({
			title: novel.title,
			htmlContent: htmlContent,
		});
		
		if (exportResult.success) {
			window.showAlert(
				t('outline.exportSuccessMessage', { title: novel.title }),
				t('outline.exportSuccessTitle')
			);
		} else {
			// Don't show an error if the user just cancelled the dialog.
			if (exportResult.message !== 'Export cancelled by user.') {
				throw new Error(exportResult.message);
			}
		}
		
	} catch (error) {
		console.error('Export failed:', error);
		window.showAlert(
			t('outline.exportErrorMessage', { message: error.message }),
			t('outline.exportErrorTitle')
		);
	}
}
