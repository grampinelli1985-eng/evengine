import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load environment variables from .env file
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Error: VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false
  }
});

const targetUserId = 'e65028e9-e04e-4069-b262-494d6dc021ee';
const targetPlan = 'sharp';

async function updatePlan() {
  console.log(`Checking profile for user: ${targetUserId}...`);
  
  // 1. Fetch current profile
  const { data: profile, error: fetchError } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', targetUserId)
    .single();

  if (fetchError) {
    console.error('Error fetching profile:', fetchError);
    return;
  }

  console.log('Current profile:', profile);

  // 2. Update plan to 'sharp'
  console.log(`Updating plan to '${targetPlan}'...`);
  const { data: updatedProfile, error: updateError } = await supabase
    .from('profiles')
    .update({ 
      plan: targetPlan,
      plan_expires_at: null // or some expiration date if desired, but default is null as per migration
    })
    .eq('id', targetUserId)
    .select()
    .single();

  if (updateError) {
    console.error('Error updating plan:', updateError);
    return;
  }

  console.log('Successfully updated profile:', updatedProfile);
}

updatePlan().catch(err => {
  console.error('Unhandled error:', err);
});
