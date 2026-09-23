#!/bin/bash
# Starts Brave with a fixed remote-debugging port so clock.js can attach to
# your already-running browser later. Use this instead of the Dock icon /
# Spotlight to open Brave from now on (e.g. set it as a Login Item) — the
# --remote-debugging-port flag only takes effect on Brave's *first* process
# launch, so if Brave gets opened some other way first, automation won't be
# able to attach until Brave is fully quit and restarted via this script.
#
# PROFILE_DIR is the on-disk folder name, not the display name shown in
# Brave's UI. Confirmed via ~/Library/Application Support/BraveSoftware/
# Brave-Browser/Local State (profile.info_cache): folder "Default" is the
# profile displayed as "Pointo" in Brave — that's the one used here.
# (Folder "Profile 1" is the "Personal" profile, not used by this script.)

PROFILE_DIR="Default"

open -a "Brave Browser" --args \
  --profile-directory="$PROFILE_DIR" \
  --remote-debugging-port=9222
