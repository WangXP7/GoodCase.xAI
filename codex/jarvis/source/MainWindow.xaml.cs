using System;
using System.IO;
using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;
using Windows.Graphics;

namespace Jarvis_VisualPrototype;

public sealed partial class MainWindow : Window
{
    public MainWindow()
    {
        App.WriteBootLog("MainWindow InitializeComponent begin");
        InitializeComponent();
        App.WriteBootLog("MainWindow InitializeComponent end");

        App.WriteBootLog("Standard Windows title bar enabled");

        var iconPath = Path.Combine(AppContext.BaseDirectory, "Assets", "AppIcon.ico");
        if (File.Exists(iconPath))
        {
            AppWindow.SetIcon(iconPath);
        }

        AppWindow.Resize(new SizeInt32(1600, 960));
        App.WriteBootLog("Initial window resize complete");
        var display = DisplayArea.GetFromWindowId(AppWindow.Id, DisplayAreaFallback.Primary);
        if (display is not null)
        {
            var area = display.WorkArea;
            var width = Math.Min(1600, area.Width);
            var height = Math.Min(960, area.Height);
            AppWindow.Resize(new SizeInt32(width, height));
            AppWindow.Move(new PointInt32(
                area.X + Math.Max(0, (area.Width - width) / 2),
                area.Y + Math.Max(0, (area.Height - height) / 2)));
        }

        App.WriteBootLog("MainPage navigation begin");
        var navigationResult = RootFrame.Navigate(typeof(MainPage));
        App.WriteBootLog($"MainPage navigation result: {navigationResult}");
    }
}
