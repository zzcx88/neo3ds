namespace Neo3dsConverter;

static class Program
{
    [STAThread]
    static int Main(string[] args)
    {
        int li = Array.IndexOf(args, "--lang");
        if (li >= 0 && li + 1 < args.Length)
            Lang.Set(args[li + 1] == "ko", remember: true);
        ApplicationConfiguration.Initialize();
        while (true)
        {
            var form = new MainForm();
            Application.Run(form);
            if (!form.Restart) return 0;
        }
    }
}
