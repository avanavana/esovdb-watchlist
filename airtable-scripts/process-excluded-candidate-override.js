/**
 *  @context Watchlist Submission Candidates › onUpdateRecord › {Flag for Inclusion}
 *  @desc When a candidate's flag for inclusion status changes to "true", update the record and send a request to the ESOVDB API to create a new submission record for the candidate. 
*/

const candidatesTable = base.getTable('Watchlist Submission Candidates');
const { candidateRecordId } = input.config();
let candidate;

try {
  candidate = await candidatesTable.selectRecordAsync(candidateRecordId);

  if (!candidate || candidate.getCellValueAsString('Classifier Result') !== 'Exclude') {
    throw new Error('This automation can only process excluded candidates.');
  }

  if (!candidate.getCellValue('Override Requested')) {
    throw new Error('This candidate does not have a pending override request.');
  }

  const submissionRecordId = candidate.getCellValueAsString('Submission Record ID');

  if (submissionRecordId) {
    throw new Error(`This candidate is already linked to submission ${submissionRecordId}.`);
  }

  const originalClassifierReason = candidate.getCellValueAsString('Classifier Reason').trim();
  const classifierReason = originalClassifierReason
    ? `Overturned classifier decision. (Original exclusion reason: ${originalClassifierReason})`
    : 'Overturned classifier decision.';

  const relevanceScore = candidate.getCellValue('Relevance Score');

  const response = await fetch(
    `https://api.esovdb.org/watch/smart-filter/candidates/${encodeURIComponent(candidate.id)}/include`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-esovdb-key': input.secret('ESOVDB_API_KEY')
      },
      body: JSON.stringify({
        videoId: candidate.getCellValueAsString('Video ID'),
        watchlistSourceRecordId: candidate.getCellValueAsString('Watchlist Source Record ID'),
        watchlistRunId: candidate.getCellValueAsString('Watchlist Run ID'),
        classifierReason,
        ...(typeof relevanceScore === 'number' ? { relevanceScore } : {})
      })
    }
  );

  const responseText = await response.text();
  let responseBody = {};

  try {
    responseBody = responseText ? JSON.parse(responseText) : {};
  } catch {
    responseBody = { error: responseText };
  }

  if (!response.ok) {
    throw new Error(responseBody.error || `The ESOVDB API returned HTTP ${response.status}.`);
  }

  if (!responseBody.submissionRecordId) {
    throw new Error('The ESOVDB API did not return a submission record ID.');
  }

  await candidatesTable.updateRecordAsync(candidate.id, {
    'Classifier Result': { name: 'Include' },
    'Classifier Reason': classifierReason,
    'Submission Record ID': responseBody.submissionRecordId,
    'Flag for Inclusion': false
  });

  output.set('submissionRecordId', responseBody.submissionRecordId);
} catch (error) {
  if (candidate && candidate.getCellValue('Flag for Inclusion')) {
    await candidatesTable.updateRecordAsync(candidate.id, { 'Flag for Inclusion': false });
  }

  throw error;
}