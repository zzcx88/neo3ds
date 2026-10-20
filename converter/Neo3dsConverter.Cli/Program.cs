namespace Neo3dsConverter;

static class Program
{
    static int Main(string[] args)
    {
        args = CommandLine.TakeLang(args);
        if (args.Length > 0) return CommandLine.Run(args);
        Console.Error.WriteLine("Usage: neo3ds-converter <game.zip> [out-dir] [options] | --launcher [out-dir] | --art-sheet sheet.png | --help");
        return 1;
    }
}
