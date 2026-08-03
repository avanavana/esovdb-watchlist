/**
 *  @context Watchlist Submission Candidates {Actions}
 *  @desc When the user presses the button in the Actions column labeled "Include Candidate", set "Flag for Inclusion" to "true", so the base automation picks up the change, updates the record, and then calls the ESOVDB API to create a submission for it.
*/

try {
  const tableId = cursor.activeTableId;
  if (!tableId) throw new Error('This script must be used on the Watchlist Submission Candidates table.');

  const table = base.getTable(tableId);
  if (table.name !== 'Watchlist Submission Candidates') throw new Error('This script must be used on the Watchlist Submission Candidates table.');

  const candidate = await input.recordAsync('Choose a candidate:', table);
  if (!candidate || candidate.getCellValueAsString('Classifier Result') !== 'Exclude') throw new Error('This script can only be run on excluded candidates.');

  const submissionRecordId = candidate.getCellValueAsString('Submission Record ID');
  if (submissionRecordId) throw new Error(`This candidate is already linked to submission ${submissionRecordId}.`);

  if (candidate.getCellValue('Flag for Inclusion')) {
      output.text('This candidate has already been flagged for inclusion.');
  } else {
      await table.updateRecordAsync(candidate.id, { 'Flag for Inclusion': true });
      output.text(`Flagged "${candidate.name}" for inclusion, overriding its previous result of excluded.`);
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  output.text(`Error: ${message}`);
}