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

            Assert.Single(dialog.TargetLabels);
            Assert.Equal(0, dialog.SelectedTarget);
            Assert.Equal("kof98.cia", dialog.TargetLabels[0]);
        }
        finally
        {
            try { Directory.Delete(root, recursive: true); } catch { /* best effort */ }
        }
    }

    /// <summary>#264: both windows serve a batch through the same Core judgement.</summary>
    [Fact]
    public void ServesTwoFilesAsOneBatch()
    {
        Exception? error = null;
        var thread = new Thread(() =>
        {
            try { RunBatch(); }
            catch (Exception ex) { error = ex; }
        });
        thread.SetApartmentState(ApartmentState.STA);
        thread.Start();
        thread.Join();
        if (error != null) ExceptionDispatchInfo.Capture(error).Throw();
    }

    static void RunBatch()
    {
        string root = Path.Combine(Path.GetTempPath(), "neo3ds-winforms-batch-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        try
        {
            string one = Path.Combine(root, "kof98.cia");
            string two = Path.Combine(root, "nam1975.cia");
            File.WriteAllBytes(one, new byte[2048]);
            File.WriteAllBytes(two, new byte[4096]);

            using var dialog = new SendDialog([], [new LanAddress("127.0.0.1", "test")]);
            dialog.ChooseMany([one, two]);

            Assert.NotNull(dialog.Sender);
            Assert.Equal(SendKind.Cia, dialog.Batch!.Kind);
            Assert.True(dialog.Batch.Allowed);
            Assert.Equal(2, dialog.BatchRows.Length);
            Assert.Contains("\n", dialog.QrText);
            Assert.Contains("2", dialog.InfoText);
        }
        finally
        {
            try { Directory.Delete(root, recursive: true); } catch { /* best effort */ }
        }
    }
}
