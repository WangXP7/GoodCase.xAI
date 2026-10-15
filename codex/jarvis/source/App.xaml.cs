using Microsoft.UI.Xaml;
using System;
using System.IO;

namespace Jarvis_VisualPrototype;

public partial class App : Application
{
    private Window? _window;

    public App()
    {
        InitializeComponent();
        UnhandledException += (_, eventArgs) =>
            WriteBootLog("UNHANDLED", eventArgs.Exception);
    }

    protected override void OnLaunched(Microsoft.UI.Xaml.LaunchActivatedEventArgs args)
    {
        try
        {
            WriteBootLog("OnLaunched begin");
            _window = new MainWindow();
            WriteBootLog("MainWindow constructed");
            _window.Activate();
            WriteBootLog("MainWindow activated");
        }
        catch (Exception exception)
        {
            WriteBootLog("OnLaunched failed", exception);
            throw;
        }
    }

    internal static void WriteBootLog(string message, Exception? exception = null)
    {
        try
        {
            var detail = exception is null ? string.Empty : $"{Environment.NewLine}{exception}";
            File.AppendAllText(
                Path.Combine(AppContext.BaseDirectory, "jarvis-startup.log"),
                $"{DateTime.Now:O}  {message}{detail}{Environment.NewLine}");
        }
        catch
        {
            // Startup diagnostics must never become a second startup failure.
        }
    }
}
