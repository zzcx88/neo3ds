namespace Neo3dsConverter;

static class Program
{
    [STAThread]
    static int Main(string[] args)
    {
        // Arguments run the command-line mode (CommandLine); --lang ko|en alone opens the window in that language.
        args = CommandLine.TakeLang(args);
        if (args.Length > 0)
        {
            AttachConsole(-1); // WinExe has no console of its own; reuse the caller's
            return CommandLine.Run(args);
        }

        ApplicationConfiguration.Initialize();
        while (true)
        {
            var form = new MainForm();
            Application.Run(form);
            if (!form.Restart) return 0;
        }
    }

    [System.Runtime.InteropServices.DllImport("kernel32.dll")]
    static extern bool AttachConsole(int processId);
}
