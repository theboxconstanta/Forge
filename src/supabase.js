import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://sdfkvfbvgpuspnnnwqwk.supabase.co'
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNkZmt2ZmJ2Z3B1c3Bubm53cXdrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIxOTg1NTksImV4cCI6MjA5Nzc3NDU1OX0.5ldMnQQ0BonEzKW9bo8b5xCr6iGoRC5ii73YL2md-aA'

export const supabase = createClient(supabaseUrl, supabaseKey)