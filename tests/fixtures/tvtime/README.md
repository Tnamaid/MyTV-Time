# TV Time fixtures

These CSVs are SYNTHETIC. They were built from the documented column names of the TV Time GDPR export, not copied from a real export. Data is fake (user_id 1 = export1, 2 = export2), show/episode ids are public TheTVDB ids.

Column order differs between export1 and export2, export1 headers/values are space-padded, and both contain extra noise columns, on purpose.

TODO: check against the real export headers on the owner's PC (`tracking-prod-records-v2.csv`, `tracking-prod-records.csv`, `followed_tv_show.csv`, `user_tv_show_data.csv`, `user_show_special_status.csv`) and adjust the parser/fixtures if names differ.

## empty-numbers/

A `tracking-prod-records-v2.csv` modelled on what the owner's real export showed: watch/rewatch rows whose `s_no` (and sometimes `ep_no`, `ep_id` or `s_id`) is empty. Line 2 has an empty `s_no`, which used to abort the import with `column "s_no" is not an integer: ""`. Row by row:

- `watch-349235` / `rewatch-349235-1`: no `s_no`, has `ep_id` and `ep_no` -> linked by `ep_id`.
- `watch-349232`: complete row.
- `watch-349238`: no `s_no` nor `ep_no` -> linked by `ep_id` (TMDB has it in season 2).
- `watch-999001`: no numbers and an `ep_id` TMDB does not know -> kept, listed in Fix imports.
- `watch-noid`: no `ep_id` -> linked by `s_no`/`ep_no`.
- `watch-777`: no `s_id` -> the only kind of row skipped (counted in the report).
