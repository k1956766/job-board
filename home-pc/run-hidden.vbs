' Runs the collector once without showing a window (called by Task Scheduler)
Set fso = CreateObject("Scripting.FileSystemObject")
here = fso.GetParentFolderName(WScript.ScriptFullName)
root = fso.GetParentFolderName(here)
cmd = "cmd /c cd /d """ & root & """ && node --env-file=home-pc\home.env collector\run.js > home-pc\collect.log 2>&1"
CreateObject("WScript.Shell").Run cmd, 0, True
