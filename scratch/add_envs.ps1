$envs = @("production", "preview", "development")
$vars = @{
  "VITE_ODDS_API_KEY" = "23ff93b41b58b2026a2fb9edfdab82ff"
  "VITE_GEMINI_API_KEY" = "AIzaSyAtPyiPpg3KLvIMVCaLKUk4Dp_6vvgGMKs"
  "API_FOOTBALL_KEY" = "4bdcbcb4703a9855eb3df258be55c915"
  "VITE_SUPABASE_URL" = "https://xzaaogfesxfwwjpeewiz.supabase.co"
  "VITE_SUPABASE_PUBLISHABLE_KEY" = "sb_publishable_QwOhqyV6K4Evp99SobxsUA_vLaScEt_"
}

$env:NO_UPDATE_NOTIFIER = "1"
$env:VERCEL_NO_UPDATE_NOTIFIER = "1"

foreach ($env in $envs) {
  foreach ($key in $vars.Keys) {
    $val = $vars[$key]
    Write-Host "Adding $key to $env..."
    $args = @("env", "add", $key, $env, "--value", $val, "--yes", "--scope", "gleidsons-projects-e461b3fb", "--force")
    
    $p = Start-Process -FilePath "vercel" -ArgumentList $args -NoNewWindow -PassThru -Wait
    if ($p.ExitCode -ne 0) {
      Write-Host "Failed to add $key to $env. Exit Code: $($p.ExitCode)"
    } else {
      Write-Host "Successfully added $key to $env"
    }
    # Pause to prevent overloading
    Start-Sleep -Seconds 1
  }
}
