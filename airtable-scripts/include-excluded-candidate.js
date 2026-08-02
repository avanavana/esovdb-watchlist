try {
  const tableId = cursor.activeTableId;

  if (!tableId) {
    throw new Error('Open the Watchlist Submission Candidates table before running this script.');
  }

  const table = base.getTable(tableId);

  if (table.name !== 'Watchlist Submission Candidates') {
    throw new Error('This script can only be run from the Watchlist Submission Candidates table.');
  }

  const candidate = await input.recordAsync('Choose a candidate:', table);

  if (!candidate || candidate.getCellValueAsString('Classifier Result') !== 'Exclude') {
    throw new Error('This script can only be run on excluded candidates.');
  }

  const submissionRecordId = candidate.getCellValueAsString('Submission Record ID');

  if (submissionRecordId) {
    throw new Error(`This candidate is already linked to submission ${submissionRecordId}.`);
  }

  if (candidate.getCellValue('Override Requested')) {
    output.text('This candidate override has already been requested.');
  } else {
    await table.updateRecordAsync(candidate.id, { 'Override Requested': true });
    output.text(`Requested an override for ${candidate.name}.`);
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  output.text(`Error: ${message}`);
}
