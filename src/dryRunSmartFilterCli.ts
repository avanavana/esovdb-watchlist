import {
  dryRunSmartFilter,
  postSmartFilterDryRunResult,
  toFailedDryRunPayload
} from './dryRunSmartFilter.js';

try {
  const payload = await dryRunSmartFilter();
  await postSmartFilterDryRunResult(payload);
} catch (err) {
  await postSmartFilterDryRunResult(toFailedDryRunPayload(err));
  throw err;
}
