CREATE TABLE IF NOT EXISTS app_settings (
  key text PRIMARY KEY,
  value text,
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "app_settings_select" ON app_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY "app_settings_all" ON app_settings FOR ALL TO authenticated USING (true);

INSERT INTO app_settings (key, value) VALUES ('cancel_window_hours', '2') ON CONFLICT (key) DO NOTHING;
