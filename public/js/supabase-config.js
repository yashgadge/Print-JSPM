import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = 'https://uonaqbsifebdvwihjjot.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_mHVimJjy-zXTsozH9GC4cQ_BOYnn8hf';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
