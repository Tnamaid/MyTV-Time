# TV Time fixtures

These CSVs are SYNTHETIC. They were built from the documented column names of the TV Time GDPR export, not copied from a real export. Data is fake (user_id 1 = export1, 2 = export2), show/episode ids are public TheTVDB ids.

Column order differs between export1 and export2, export1 headers/values are space-padded, and both contain extra noise columns, on purpose.

TODO: check against the real export headers on the owner's PC (`tracking-prod-records-v2.csv`, `tracking-prod-records.csv`, `followed_tv_show.csv`, `user_tv_show_data.csv`, `user_show_special_status.csv`) and adjust the parser/fixtures if names differ.
