using System;
using System.Diagnostics;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Shapes;
using Windows.Foundation;
using Windows.Graphics;
using Windows.UI;

namespace Jarvis_VisualPrototype;

public sealed partial class OverlayWindow : Window
{
    private readonly DispatcherQueueTimer _timer;
    private readonly Stopwatch _clock = Stopwatch.StartNew();
    private readonly Polyline _waveGlow;
    private readonly Polyline _waveLine;
    private readonly RotateTransform _outerRotation = new() { CenterX = 48, CenterY = 48 };

    public OverlayWindow()
    {
        InitializeComponent();
        var supportsBorderlessPresenter = Environment.OSVersion.Version.Build >= 22000;
        if (supportsBorderlessPresenter)
        {
            ExtendsContentIntoTitleBar = true;
            SetTitleBar(DragRegion);
        }
        else
        {
            App.WriteBootLog("Overlay using Windows 10 standard-title-bar fallback");
        }

        AppWindow.Resize(new SizeInt32(540, 310));
        var display = DisplayArea.GetFromWindowId(AppWindow.Id, DisplayAreaFallback.Primary);
        if (display is not null)
        {
            var area = display.WorkArea;
            AppWindow.Move(new PointInt32(area.X + area.Width - 560, area.Y + 24));
        }

        if (AppWindow.Presenter is OverlappedPresenter presenter)
        {
            presenter.IsAlwaysOnTop = true;
            presenter.IsResizable = false;
            presenter.IsMaximizable = false;
            presenter.IsMinimizable = false;
            if (supportsBorderlessPresenter)
            {
                try
                {
                    presenter.SetBorderAndTitleBar(false, false);
                }
                catch (Exception exception)
                {
                    App.WriteBootLog("Borderless overlay unavailable; standard border retained", exception);
                }
            }
        }

        OuterRing.RenderTransform = _outerRotation;
        _waveGlow = new Polyline { Stroke = Brush(55, 56, 231, 255), StrokeThickness = 7 };
        _waveLine = new Polyline { Stroke = Brush(245, 83, 238, 255), StrokeThickness = 2 };
        OverlayWaveCanvas.Children.Add(_waveGlow);
        OverlayWaveCanvas.Children.Add(_waveLine);

        _timer = DispatcherQueue.CreateTimer();
        _timer.Interval = TimeSpan.FromMilliseconds(33);
        _timer.Tick += Tick;
        _timer.Start();
        Closed += (_, _) => _timer.Stop();
    }

    private void Tick(DispatcherQueueTimer sender, object args)
    {
        var t = _clock.Elapsed.TotalSeconds;
        _outerRotation.Angle = t * 13;
        OverlayCore.Opacity = 0.62 + 0.38 * (0.5 + 0.5 * Math.Sin(t * 2.8));

        var width = Math.Max(250, OverlayWaveCanvas.ActualWidth);
        var points = new PointCollection();
        var glowPoints = new PointCollection();
        for (var x = 0.0; x <= width; x += 3)
        {
            var envelope = Math.Pow(Math.Sin(Math.PI * x / width), 0.7);
            var signal = Math.Sin(x * 0.18 + t * 5.2) + 0.42 * Math.Sin(x * 0.44 - t * 6.7);
            var point = new Point(x, 18 + signal * envelope * 10);
            points.Add(point);
            glowPoints.Add(point);
        }
        _waveGlow.Points = points;
        _waveLine.Points = glowPoints;
    }

    private void Close_Click(object sender, RoutedEventArgs e) => Close();

    private static SolidColorBrush Brush(byte alpha, byte red, byte green, byte blue) =>
        new(Color.FromArgb(alpha, red, green, blue));
}
