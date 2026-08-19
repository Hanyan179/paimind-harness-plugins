WITH source_rows AS (
    SELECT
        CAST(t1.upc AS NVARCHAR(255)) AS upc,
        t1.item_name,
        TRY_CONVERT(date, t1.[week]) AS week_date,
        TRY_CONVERT(float, t1.sales_value) AS sales_value,
        TRY_CONVERT(float, t1.sales_units) AS sales_units,
        t2.category,
        t2.subcategory,
        t2.brand,
        t2.reviewed_fineline,
        t2.source_fineline,
        COALESCE(NULLIF(t2.reviewed_fineline, ''), NULLIF(t2.source_fineline, '')) AS final_fineline,
        TRY_CONVERT(int, t3.fiscal_year) AS fiscal_year,
        TRY_CONVERT(int, t3.fiscal_week) AS fiscal_week,
        CAST(t3.fiscal_year_week AS NVARCHAR(20)) AS fiscal_year_week,
        (TRY_CONVERT(int, t3.fiscal_year) * 100 + TRY_CONVERT(int, t3.fiscal_week)) AS fiscal_year_week_sort
    FROM scintilla.performanceindetailtrends t1
    LEFT JOIN scintilla.AssortmentProductReviewedFineline t2
        ON t1.upc = t2.product_code
    LEFT JOIN scintilla.fiscalcalendar t3
        ON t1.[week] = t3.[date]
    WHERE 1 = 1
{{where_clause}}
)
SELECT
    upc,
    item_name,
    week_date,
    sales_value,
    sales_units,
    category,
    subcategory,
    brand,
    reviewed_fineline,
    source_fineline,
    final_fineline,
    fiscal_year,
    fiscal_week,
    fiscal_year_week,
    fiscal_year_week_sort
FROM source_rows
WHERE week_date IS NOT NULL
  AND fiscal_year_week_sort IS NOT NULL;
