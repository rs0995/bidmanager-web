# Git push scope from MacinCloud

When operating from the MacinCloud remote Mac (used only for iOS/Xcode builds), never `git push` changes from any folder other than `Mobile App RN`. If other folders show local modifications there (e.g. stray edits, generated files), leave them uncommitted/unpushed rather than including them in a push — only `Mobile App RN` changes should go out from that machine.
