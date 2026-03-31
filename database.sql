-- 1. Opret Tabel for Brugere (Personalet)
CREATE TABLE IF NOT EXISTS betjente (
  id UUID PRIMARY KEY DEFAULT auth.uid(),
  email TEXT UNIQUE NOT NULL,
  navn TEXT NOT NULL,
  rolle TEXT DEFAULT 'betjent', -- 'admin' eller 'betjent'
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. Opret Tabel for Sager (MDT)
CREATE TABLE IF NOT EXISTS sager (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  navn TEXT NOT NULL,
  foedselsdag DATE NOT NULL,
  cpr TEXT NOT NULL,
  beskrivelse TEXT,
  oprettet_af UUID REFERENCES auth.users(id),
  oprettet_dato TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  sidst_redigeret_af UUID REFERENCES auth.users(id),
  sidst_redigeret_dato TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 3. Opret Tabel for Logs (Audit trail)
CREATE TABLE IF NOT EXISTS sags_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sags_id UUID REFERENCES sager(id) ON DELETE CASCADE,
  bruger_id UUID REFERENCES auth.users(id),
  handling TEXT NOT NULL, -- 'opret', 'rediger', 'slet'
  dato TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 4. Aktiver RLS (Row Level Security)
ALTER TABLE sager ENABLE ROW LEVEL SECURITY;
ALTER TABLE betjente ENABLE ROW LEVEL SECURITY;

-- 5. Policies for Sager (Hvem må hvad?)
CREATE POLICY "Betjente kan se alle sager" ON sager
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Admin kan alt" ON sager
  FOR ALL USING (
    EXISTS (SELECT 1 FROM betjente WHERE id = auth.uid() AND rolle = 'admin')
  );

CREATE POLICY "Betjente kan oprette sager" ON sager
  FOR INSERT WITH CHECK (auth.uid() = oprettet_af);

CREATE POLICY "Betjente kan redigere egne sager" ON sager
  FOR UPDATE USING (auth.uid() = oprettet_af);
