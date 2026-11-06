using System.Runtime.ExceptionServices;
using Neo3dsConverter;
using Xunit;

namespace Neo3dsConverter.WinForms.Tests;

/// <summary>#299: the Windows send window lists the session CIAs instead of throwing on open.</summary>
public sealed class SendDialogTests
{
    [Fact]
    public void ListsSessionCiasAndSelectsTheFirst()
    {
        Exception? error = null;
        var thread = new Thread(() =>
        {
            try { Run(); }
            catch (Exception ex) { error = ex; }
        });
        thread.SetApartmentState(ApartmentState.STA);
        thread.Start();
        thread.Join();
        if (error != null) ExceptionDispatchInfo.Capture(error).Throw();
    }

    static void Run()
    {
        string root = Path.Combine(Path.GetTempPath(), "neo3ds-winforms-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        try
        {
            string cia = Path.Combine(root, "kof98.cia");
            File.WriteAllBytes(cia, new byte[1024]);

            using var dialog = new SendDialog(
                [new SessionCia(cia, Launcher: false)],
                [new LanAddress("127.0.0.1", "test")]);

            Assert.Equal(1, dialog.Targets.Items.Count);
            Assert.Equal(0, dialog.Targets.SelectedIndex);
            Assert.Contains("kof98.cia", dialog.Targets.Items[0]!.ToString());
        }
        finally
        {
            try { Directory.Delete(root, recursive: true); } catch { /* best effort */ }
        }
    }
}
