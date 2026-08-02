const apiBaseUrl = 'https://api.esovdb.org';
const watchlistOverrideKey = 'REPLACE_WITH_WATCHLIST_OVERRIDE_KEY';

async function includeExcludedCandidate() {
  const candidatesTable = base.getTable('Watchlist Submission Candidates');
  const candidate = await input.recordAsync('Choose an excluded candidate', candidatesTable);

  if (!candidate) {
    output.markdown('No candidate selected.');
    return;
  }

  const classifierResult = candidate.getCellValueAsString('Classifier Result');
  const submissionRecordId = candidate.getCellValueAsString('Submission Record ID');

  if (classifierResult !== 'Exclude') {
    output.markdown(`This candidate cannot be included because its classifier result is **${classifierResult || 'blank'}**.`);
    return;
  }

  if (submissionRecordId) {
    output.markdown(`This candidate is already linked to submission **${submissionRecordId}**.`);
    return;
  }

  output.markdown('Creating the submission and recording the overturned classifier decision…');

  const response = await remoteFetchAsync(
    `${apiBaseUrl}/watch/smart-filter/candidates/${encodeURIComponent(candidate.id)}/include`,
    {
      method: 'POST',
      headers: {
        'x-esovdb-watchlist-override-key': watchlistOverrideKey
      }
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

  output.markdown(
    responseBody.alreadyIncluded
      ? `This decision was already overturned and is linked to submission **${responseBody.submissionRecordId}**.`
      : `Included **${candidate.name}** and created submission **${responseBody.submissionRecordId}**.`
  );
}

await includeExcludedCandidate();
