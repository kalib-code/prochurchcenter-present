"""Regenerate the .pptx test fixtures.

    pip install python-pptx && python3 make_test_deck.py

Produces two decks in this directory:

  test-deck.pptx         5 visible slides — title, bullets, table, chart, styled text
  test-deck-hidden.pptx  7 slide parts, the 6th hidden, so 6 visible

The hidden slide exists to pin down slide-index mapping. PowerPoint skips hidden
slides when presenting, so probeVisibleSlideCount must report 6, not 7, and
visible ordinal 6 must resolve to source index 7.
"""
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from pptx.chart.data import CategoryChartData
from pptx.enum.chart import XL_CHART_TYPE

prs = Presentation()
prs.slide_width = Inches(13.333)   # 16:9, what a projector wants
prs.slide_height = Inches(7.5)

# 1. Title slide
s = prs.slides.add_slide(prs.slide_layouts[0])
s.shapes.title.text = "Sunday Service"
s.placeholders[1].text = "Announcements — July 2026"

# 2. Bulleted text, custom colors
s = prs.slides.add_slide(prs.slide_layouts[1])
s.shapes.title.text = "This Week"
tf = s.placeholders[1].text_frame
tf.text = "Prayer meeting — Wednesday 7pm"
for line in ["Youth fellowship — Friday", "Baptism class starts Sunday"]:
    p = tf.add_paragraph()
    p.text = line
    p.font.size = Pt(28)
    p.font.color.rgb = RGBColor(0x1F, 0x4E, 0x79)

# 3. Table
s = prs.slides.add_slide(prs.slide_layouts[5])
s.shapes.title.text = "Giving Update"
tbl = s.shapes.add_table(3, 3, Inches(1), Inches(2), Inches(11), Inches(3)).table
for c, h in enumerate(["Fund", "Goal", "Received"]):
    tbl.cell(0, c).text = h
for r, row in enumerate([["Building", "500,000", "312,400"],
                         ["Missions", "150,000", "148,900"]], start=1):
    for c, v in enumerate(row):
        tbl.cell(r, c).text = v

# 4. Chart
s = prs.slides.add_slide(prs.slide_layouts[5])
s.shapes.title.text = "Attendance"
cd = CategoryChartData()
cd.categories = ["Jan", "Feb", "Mar", "Apr"]
cd.add_series("Sunday AM", (210, 245, 233, 268))
s.shapes.add_chart(XL_CHART_TYPE.COLUMN_CLUSTERED,
                   Inches(1), Inches(2), Inches(11), Inches(4.5), cd)

# 5. Big verse text, off-theme font
s = prs.slides.add_slide(prs.slide_layouts[6])
box = s.shapes.add_textbox(Inches(1), Inches(2.5), Inches(11), Inches(3))
p = box.text_frame.paragraphs[0]
p.text = "For God so loved the world..."
p.font.size = Pt(44)
p.font.name = "Georgia"
p.font.bold = True

prs.save("test-deck.pptx")
print("test-deck.pptx — visible slides:", len(prs.slides._sldIdLst))

# Second fixture: append a hidden slide, then a visible one after it, so the
# hidden slide sits in the middle and a naive count is provably wrong.
s = prs.slides.add_slide(prs.slide_layouts[5])
s.shapes.title.text = "HIDDEN — draft, do not show"
s.element.set("show", "0")

s = prs.slides.add_slide(prs.slide_layouts[5])
s.shapes.title.text = "Closing — Go in peace"

prs.save("test-deck-hidden.pptx")
visible = [sl for sl in prs.slides if sl.element.get("show", "1") != "0"]
print(
    f"test-deck-hidden.pptx — {len(prs.slides._sldIdLst)} parts, "
    f"{len(visible)} visible"
)
